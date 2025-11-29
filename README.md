# node-red-contrib-solution-engine

Node-RED nodes for interacting with Solution Engine and MTConnect devices.

## Source

[Full source is available in GitHub](https://github.com/ctacke/node-red-contrib-solution-engine)

## Installation

Install the package by first navigating to the local node-RED folder.

On Windows this will likely be

```powershell
cd C:\Users\<my-user-name>\.node-red
npm install node-red-contrib-your-node
```
or on Linux
```bash
cd ~/.node-red
npm install node-red-contrib-solution-engine
```

Or for development:

```bash
cd /path/to/node-red-contrib-solution-engine
npm link

cd ~/.node-red
npm link node-red-contrib-solution-engine
```

Restart Node-RED after installation.

## Nodes

### MTConnect Data Item (Read)

Reads a specific data item value from an MTConnect endpoint. Supports both Solution Engine and generic MTConnect brokers.

**Configuration:**
- **Host**: IP address or hostname (e.g., `192.168.5.90`, `mtconnect.mazakcorp.com`)
- **Port**: MTConnect port (default: `5000`)
- **Path**: Optional path for generic brokers (leave empty for most cases)
- **Data Item ID**: The dataItemId to query (e.g., `EngineInfo.EngineID`)

**Input:**
- `msg.payload`: Any value (triggers the read)
- `msg.host`: (optional) Override configured host
- `msg.port`: (optional) Override configured port
- `msg.path`: (optional) Override configured path
- `msg.dataItemId`: (optional) Override configured data item ID

**Output:**
- `msg.payload`: The data item value
- `msg.dataItemId`: The data item ID that was queried
- `msg.timestamp`: MTConnect timestamp
- `msg.sequence`: MTConnect sequence number
- `msg.name`: Friendly name of the data item

**Broker Detection:**

The node automatically detects whether the target is a Solution Engine or generic MTConnect broker:
- **Solution Engine**: Uses `/api/v6/mtc/current`
- **Generic broker**: Uses `/{path}/current` or `/current`

The broker type is cached after first detection for performance.

**Examples:**

*Solution Engine:*
```
Host: 192.168.5.90
Port: 7200
Path: (empty)
Data Item ID: EngineInfo.EngineID
→ URL: http://192.168.5.90:7200/api/v6/mtc/current
→ Returns: "DCA6326DA159"
```

*Mazak Demo Broker:*
```
Host: mtconnect.mazakcorp.com
Port: 5610
Path: (empty)
Data Item ID: xpm
→ URL: http://mtconnect.mazakcorp.com:5610/current
→ Returns: "UNAVAILABLE"
```

**Important:** Data item IDs are **case-sensitive**. Use exact case from the MTConnect XML (e.g., `EngineInfo.EngineID` not `EngineInfo.EngineId`).

---

### Engine Set Data Item (Write)

Sets a data item value on a Solution Engine device.

**Configuration:**
- **Host**: IP address or hostname (e.g., `192.168.5.90`)
- **Port**: Solution Engine port (default: `7200`)
- **Data Item ID**: The dataItemId to set (e.g., `EngineInfo.Location.PostalCode`)

**Input:**
- `msg.payload`: The value to set (string or number)
- `msg.value`: (alternative to payload) The value to set
- `msg.host`: (optional) Override configured host
- `msg.port`: (optional) Override configured port
- `msg.dataItemId`: (optional) Override configured data item ID

**Output:**
- `msg.payload.success`: `true` if successful, `false` if error
- `msg.payload.dataItemId`: The data item ID that was set
- `msg.payload.value`: The value that was sent
- `msg.payload.statusCode`: HTTP status code
- `msg.response`: Server response (if any)

**Endpoint:**
```
PUT http://{host}:{port}/api/v6/agent/data
```

**Request Body (XML):**
```xml
<DataItems>
    <DataItem dataItemId="EngineInfo.Location.PostalCode">
        <Value>12345</Value>
    </DataItem>
</DataItems>
```

**Example:**

*Set a postal code:*
```javascript
msg.payload = "12345";
// Data Item ID configured as: EngineInfo.Location.PostalCode
// → Sends PUT request with XML body
// → Returns: { success: true, dataItemId: "...", value: "12345", statusCode: 200 }
```

**Note:** This node only works with Solution Engine devices, not generic MTConnect brokers.

---

## Status Indicators

Both nodes show visual status indicators:

- **Blue dot**: Request in progress
- **Green dot**: Success
- **Yellow ring**: Data item not found (read node only)
- **Red ring**: Error occurred

---

## Flow Examples

### Basic Read Flow

```
[Inject] → [MTConnect Data Item] → [Debug]

Inject: Every 5 seconds
MTConnect Data Item:
  Host: 192.168.5.90
  Port: 7200
  Data Item ID: EngineInfo.CPUTemp
Debug: msg.payload
```

### Read and Write Flow

```
[Inject] → [Change] → [Engine Set Data Item] → [Delay] → [MTConnect Data Item] → [Debug]

Inject: Manual trigger
Change: Set msg.payload = "New Value"
Engine Set Data Item:
  Host: 192.168.5.90
  Port: 7200
  Data Item ID: MyComponent.MyValue
Delay: 1 second
MTConnect Data Item:
  Host: 192.168.5.90
  Port: 7200
  Data Item ID: MyComponent.MyValue
Debug: msg.payload
```

### Multiple Hosts

```
[Inject] → [MTConnect Data Item (Engine 1)] → [Debug]
           [MTConnect Data Item (Engine 2)] → [Debug]
           [MTConnect Data Item (Mazak)] → [Debug]
```

Each node can target a different host. Broker type is cached per `host:port` combination.

---

## Troubleshooting

### "Data item not found"

1. **Check case sensitivity**: Data item IDs are case-sensitive. Verify the exact case in the MTConnect XML response.
2. **Verify the data item exists**: Open `http://{host}:{port}/api/v6/mtc/current` in a browser and search for the `dataItemId` attribute.
3. **Check broker detection**: Look at Node-RED logs to see which URL is being used.

### Wrong URL being used

The broker type is cached in memory. Restart Node-RED to clear the cache if you changed the configuration.

### Connection errors

1. Verify the host and port are correct
2. Check network connectivity: `curl http://{host}:{port}/current`
3. Check firewall settings

---

## Logging

Both nodes log useful debug information. View logs in the Node-RED console:

```
Detecting broker type for 192.168.5.90:7200...
Broker detection complete: isSolutionEngine=true
Fetching from: http://192.168.5.90:7200/api/v6/mtc/current
PUT to http://192.168.5.90:7200/api/v6/agent/data with body: <DataItems>...
```

---

## License

MIT

## Author

Chris Tacke - LECS Energy

## Keywords

- node-red
- solutionengine
- mtconnect
- manufacturing
- lecenergy
- lecs
