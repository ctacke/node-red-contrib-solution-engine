module.exports = function(RED) {
    const http = require('http');
    const https = require('https');

    // Cache for broker type detection (SolutionEngine vs generic)
    // Key: "host:port", Value: { isSolutionEngine: boolean }
    const brokerTypeCache = {};

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

    function MTConnectDataItemNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Configuration from editor
        this.host = config.host;
        this.port = config.port || 5000;
        this.path = config.path || '';
        this.dataItemId = config.dataItemId;

        node.on('input', function(msg, send, done) {
            // Allow message to override config values
            const rawHost = msg.host || node.host;
            const port = msg.port || node.port;
            const path = msg.path !== undefined ? msg.path : node.path;
            const dataItemId = msg.dataItemId || node.dataItemId;

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

            node.status({ fill: "blue", shape: "dot", text: "requesting..." });

            // Normalize the host to handle http://, https://, or no prefix
            const { hostname, protocol, isHttps } = normalizeHost(rawHost);
            const cacheKey = `${hostname}:${port}`;

            // Check if we already know the broker type
            if (brokerTypeCache[cacheKey] !== undefined) {
                node.log(`Using cached broker type: isSolutionEngine=${brokerTypeCache[cacheKey].isSolutionEngine}`);
                const url = buildUrl(hostname, port, path, brokerTypeCache[cacheKey].isSolutionEngine, protocol);
                fetchDataItem(node, url, dataItemId, msg, send, done, isHttps);
            } else {
                // Detect broker type by trying SolutionEngine endpoint first
                node.log(`Detecting broker type for ${cacheKey}...`);
                detectBrokerType(hostname, port, protocol, isHttps, (isSolutionEngine) => {
                    node.log(`Broker detection complete: isSolutionEngine=${isSolutionEngine}`);
                    brokerTypeCache[cacheKey] = { isSolutionEngine };
                    const url = buildUrl(hostname, port, path, isSolutionEngine, protocol);
                    fetchDataItem(node, url, dataItemId, msg, send, done, isHttps);
                });
            }
        });

        node.on('close', function() {
            node.status({});
        });
    }

    /**
     * Build the MTConnect current URL based on broker type
     */
    function buildUrl(host, port, path, isSolutionEngine, protocol = 'http:') {
        const baseUrl = `${protocol}//${host}:${port}`;

        if (isSolutionEngine) {
            return `${baseUrl}/api/v6/mtc/current`;
        } else if (path) {
            // Generic broker with custom path
            // Remove leading/trailing slashes for consistency
            const cleanPath = path.replace(/^\/+|\/+$/g, '');
            return `${baseUrl}/${cleanPath}/current`;
        } else {
            // Generic broker at root
            return `${baseUrl}/current`;
        }
    }

    /**
     * Detect if the broker is a SolutionEngine by checking the API endpoint
     * Must check response content because some brokers return 200 even for errors
     */
    function detectBrokerType(host, port, protocol, isHttps, callback) {
        const testUrl = `${protocol}//${host}:${port}/api/v6/mtc/current`;
        const httpModule = isHttps ? https : http;

        const req = httpModule.get(testUrl, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                // Check if response is valid MTConnect data (not an error)
                // SolutionEngine returns MTConnectStreams, errors return MTConnectError
                if (res.statusCode === 200 &&
                    data.includes('MTConnectStreams') &&
                    !data.includes('MTConnectError')) {
                    callback(true);
                } else {
                    callback(false);
                }
            });
        });

        req.on('error', () => {
            // Connection error or endpoint doesn't exist - not a SolutionEngine
            callback(false);
        });

        // Set a short timeout for detection
        req.setTimeout(3000, () => {
            req.destroy();
            callback(false);
        });
    }

    /**
     * Fetch the data item from the MTConnect endpoint
     */
    function fetchDataItem(node, url, dataItemId, msg, send, done, isHttps = false) {
        node.log(`Fetching from: ${url}`);
        const httpModule = isHttps ? https : http;

        httpModule.get(url, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    // Find the data item in the XML by dataItemId attribute
                    const result = findDataItemInXml(data, dataItemId);

                    if (result.found) {
                        msg.payload = result.value;
                        msg.dataItemId = dataItemId;
                        msg.timestamp = result.timestamp;
                        msg.sequence = result.sequence;
                        msg.name = result.name;
                        node.status({ fill: "green", shape: "dot", text: result.value });
                        send(msg);
                    } else {
                        node.status({ fill: "yellow", shape: "ring", text: "not found" });
                        node.warn(`Data item '${dataItemId}' not found in response`);
                        msg.payload = null;
                        msg.dataItemId = dataItemId;
                        msg.error = `Data item '${dataItemId}' not found`;
                        send(msg);
                    }

                    if (done) done();
                } catch (err) {
                    node.status({ fill: "red", shape: "ring", text: "parse error" });
                    node.error("Failed to parse MTConnect response: " + err.message, msg);
                    if (done) done(err);
                }
            });
        }).on('error', (err) => {
            node.status({ fill: "red", shape: "ring", text: "error" });
            node.error("HTTP request failed: " + err.message, msg);
            if (done) done(err);
        });
    }

    /**
     * Find a data item in MTConnect XML by its dataItemId attribute
     * Uses regex to avoid external XML parser dependencies
     */
    function findDataItemInXml(xml, dataItemId) {
        // Escape special regex characters in the dataItemId
        const escapedId = dataItemId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Search for the dataItemId and extract value (case-sensitive)
        const simplePattern = new RegExp(
            `dataItemId="${escapedId}"[^>]*>([^<]*)<`
        );

        let match = xml.match(simplePattern);

        if (match) {
            // Try to get other attributes
            const fullElementPattern = new RegExp(
                `<\\w+[^>]*dataItemId="${escapedId}"[^>]*>`
            );
            const elementMatch = xml.match(fullElementPattern);
            let timestamp = null;
            let sequence = null;
            let name = null;

            if (elementMatch) {
                const elem = elementMatch[0];
                const tsMatch = elem.match(/timestamp="([^"]*)"/);
                const seqMatch = elem.match(/sequence="([^"]*)"/);
                const nameMatch = elem.match(/name="([^"]*)"/);

                timestamp = tsMatch ? tsMatch[1] : null;
                sequence = seqMatch ? seqMatch[1] : null;
                name = nameMatch ? nameMatch[1] : null;
            }

            return {
                found: true,
                value: match[1].trim(),
                sequence: sequence,
                timestamp: timestamp,
                name: name || dataItemId.split('.').pop()
            };
        }

        return { found: false };
    }

    RED.nodes.registerType("mtconnect-dataitem", MTConnectDataItemNode);
};
