# Crypto Wallet Backend API

Backend proxy service for fetching transaction history via Alchemy API. Keeps Alchemy API keys secure on the server side.

## Setup

1. **Install dependencies:**
   ```bash
   cd backend
   npm install
   # or
   pnpm install
   ```

2. **Configure environment variables:**
   ```bash
   cp env.example .env
   ```
   
   Edit `.env` and add your Alchemy API keys:
   ```env
   ALCHEMY_KEY_ETH=your_eth_mainnet_key_here
   ALCHEMY_KEY_BASE=your_base_mainnet_key_here
   ALCHEMY_KEY_ARB=your_arbitrum_mainnet_key_here
   ALCHEMY_KEY_POLY=your_polygon_mainnet_key_here
   ```

3. **Build and run:**
   ```bash
   # Development mode
   npm run start:dev
   
   # Production build
   npm run build
   npm run start:prod
   ```

The server will start on `http://localhost:3000` (or the port specified in `.env`).

## API Endpoints

### GET `/evm/:chainId/tx-history`

Fetch transaction history for an address.

**Parameters:**
- `chainId` (path): Chain ID (1=Ethereum, 8453=Base, 42161=Arbitrum, 137=Polygon, etc.)
- `address` (query, required): Ethereum address (0x...)
- `pageKey` (query, optional): Pagination cursor from previous response
- `pageSize` (query, optional): Number of results per page (default: 100, max: 100)
- `fromBlock` (query, optional): Starting block (hex, default: 0x0)
- `categories` (query, optional): Comma-separated list (external,erc20,erc721,erc1155)

**Example:**
```bash
curl "http://localhost:3000/evm/1/tx-history?address=0xabc...&pageSize=20"
```

**Response:**
```json
{
  "items": [
    {
      "hash": "0x...",
      "chainId": 1,
      "timestamp": "2026-01-13T02:14:11.000Z",
      "direction": "out",
      "assetType": "erc20",
      "from": "0xabc...",
      "to": "0xdef...",
      "value": "12.5",
      "symbol": "USDC",
      "tokenAddress": "0xA0b8..."
    }
  ],
  "nextPageKey": "..."
}
```

## Features

- ✅ **Rate Limiting**: 60 requests/minute per IP
- ✅ **Caching**: In-memory cache (1 min for first page, 5 min for paginated)
- ✅ **Input Validation**: Address format, chainId, pageSize validation
- ✅ **Error Handling**: Comprehensive error messages
- ✅ **Logging**: Request logging with latency tracking

## Supported Chains

- Ethereum Mainnet (1)
- Base (8453)
- Arbitrum (42161)
- Polygon (137)
- Sepolia Testnet (11155111)
- Base Sepolia (84532)

## Mobile App Configuration

In your mobile app `.env` or `app.json`, set:
```env
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000
```

For production, use your deployed backend URL.

