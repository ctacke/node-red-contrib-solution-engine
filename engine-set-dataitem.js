module.exports = function(RED) {
    const http = require('http');
    const https = require('https');

    /**
     * Normalize host input by handling protocol prefixes and trailing slashes
     * @param {string} host - Host string (may include http://, https://, and/or trailing slashes)
     * @returns {Object} { hostname: string, protocol: string, isHttps: boolean }
     */
    function normalizeHost(host) {
        if (!host) return { hostname: '', protocol: 'http:', isHttps: false };

        let hostname = host;
        let protocol = 'http:';
        let isHttps = false;

        // Check for https:// prefix
        if (hostname.startsWith('https://')) {
            hostname = hostname.substring(8); // Remove 'https://'
            protocol = 'https:';
            isHttps = true;
        }
        // Check for http:// prefix
        else if (hostname.startsWith('http://')) {
            hostname = hostname.substring(7); // Remove 'http://'
            protocol = 'http:';
            isHttps = false;
        }

        // Strip trailing slashes
        hostname = hostname.replace(/\/+$/, '');

        return {
            hostname: hostname,
            protocol: protocol,
            isHttps: isHttps
        };
    }

    /**
     * Escape special XML characters
     */
    function escapeXml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function SolutionEngineSetDataItemNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Configuration from editor
        this.host = config.host;
        this.port = config.port || 7200;
        this.dataItemId = config.dataItemId;

        node.on('input', function(msg, send, done) {
            // Allow message to override config values
            const rawHost = msg.host || node.host;
            const port = msg.port || node.port;
            const dataItemId = msg.dataItemId || node.dataItemId;

            // Value comes from msg.payload or can be specified in msg.value
            const value = msg.value !== undefined ? msg.value : msg.payload;

            if (!rawHost) {
                node.error("No host specified", msg);
                if (done) done();
                return;
            }

            if (!dataItemId) {
                node.error("No data item ID specified", msg);
                if (done) done();
                return;
            }

            if (value === undefined || value === null) {
                node.error("No value specified (use msg.payload or msg.value)", msg);
                if (done) done();
                return;
            }

            node.status({ fill: "blue", shape: "dot", text: "sending..." });

            // Normalize the host to handle http://, https://, or no prefix
            const { hostname, protocol, isHttps } = normalizeHost(rawHost);

            // Build the XML request body
            const body = `<DataItems>
    <DataItem dataItemId="${escapeXml(dataItemId)}">
        <Value>${escapeXml(String(value))}</Value>
    </DataItem>
</DataItems>`;

            const options = {
                hostname: hostname,
                port: port,
                path: '/api/v6/agent/data',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/xml',
                    'Content-Length': Buffer.byteLength(body)
                }
            };

            node.log(`POST to ${protocol}//${hostname}:${port}/api/v6/agent/data with body: ${body}`);

            const httpModule = isHttps ? https : http;
            const req = httpModule.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        node.status({ fill: "green", shape: "dot", text: `set ${dataItemId}` });
                        msg.payload = {
                            success: true,
                            dataItemId: dataItemId,
                            value: value,
                            statusCode: res.statusCode
                        };
                        if (data) {
                            try {
                                msg.response = JSON.parse(data);
                            } catch (e) {
                                msg.response = data;
                            }
                        }
                        send(msg);
                    } else {
                        node.status({ fill: "red", shape: "ring", text: `error ${res.statusCode}` });
                        node.error(`HTTP ${res.statusCode}: ${data}`, msg);
                        msg.payload = {
                            success: false,
                            dataItemId: dataItemId,
                            value: value,
                            statusCode: res.statusCode,
                            error: data
                        };
                        send(msg);
                    }

                    if (done) done();
                });
            });

            req.on('error', (err) => {
                node.status({ fill: "red", shape: "ring", text: "error" });
                node.error("HTTP request failed: " + err.message, msg);
                msg.payload = {
                    success: false,
                    dataItemId: dataItemId,
                    value: value,
                    error: err.message
                };
                send(msg);
                if (done) done(err);
            });

            req.setTimeout(10000, () => {
                req.destroy();
                node.status({ fill: "red", shape: "ring", text: "timeout" });
                node.error("Request timed out", msg);
                if (done) done(new Error("Request timed out"));
            });

            req.write(body);
            req.end();
        });

        node.on('close', function() {
            node.status({});
        });
    }

    RED.nodes.registerType("engine-set-dataitem", SolutionEngineSetDataItemNode);
};
