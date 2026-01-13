import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Inject } from "@nestjs/common";
import { Cache } from "cache-manager";

export interface TxItem {
  hash: string;
  chainId: number;
  timestamp: string;
  direction: "in" | "out" | "self" | "unknown";
  assetType: "native" | "erc20" | "erc721" | "erc1155";
  from: string;
  to: string;
  value: string;
  symbol?: string;
  tokenAddress?: string;
  tokenId?: string;
  raw?: any;
}

export interface TxHistoryResponse {
  items: TxItem[];
  nextPageKey?: string;
}

interface AlchemyTransfer {
  blockNum: string;
  hash: string;
  from: string;
  to: string;
  value?: number;
  asset: string;
  category: "external" | "erc20" | "erc721" | "erc1155";
  rawContract?: {
    value?: string;
    address?: string;
    decimal?: string;
  };
  tokenId?: string;
  metadata?: {
    blockTimestamp: string;
  };
}

interface AlchemyResponse {
  transfers: AlchemyTransfer[];
  pageKey?: string;
}

@Injectable()
export class EvmService {
  private readonly logger = new Logger(EvmService.name);
  private readonly chainIdToKey: Record<number, string> = {
    1: "ALCHEMY_KEY_ETH",
    8453: "ALCHEMY_KEY_BASE",
    42161: "ALCHEMY_KEY_ARB",
    137: "ALCHEMY_KEY_POLY",
    11155111: "ALCHEMY_KEY_SEPOLIA",
    84532: "ALCHEMY_KEY_BASE_SEPOLIA",
  };

  private readonly chainIdToNetwork: Record<number, string> = {
    1: "eth-mainnet",
    8453: "base-mainnet",
    42161: "arb-mainnet",
    137: "polygon-mainnet",
    11155111: "eth-sepolia",
    84532: "base-sepolia",
  };

  constructor(
    private configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache
  ) {}

  private getAlchemyUrl(chainId: number): string {
    const keyName = this.chainIdToKey[chainId];
    if (!keyName) {
      throw new BadRequestException(`Unsupported chainId: ${chainId}`);
    }

    const apiKey = this.configService.get<string>(keyName);
    if (!apiKey) {
      throw new BadRequestException(
        `Alchemy API key not configured for chainId: ${chainId}`
      );
    }

    const network = this.chainIdToNetwork[chainId];
    return `https://${network}.g.alchemy.com/v2/${apiKey}`;
  }

  private validateAddress(address: string): void {
    if (!address.startsWith("0x")) {
      throw new BadRequestException("Address must start with 0x");
    }
    if (address.length !== 42) {
      throw new BadRequestException("Address must be 42 characters");
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new BadRequestException("Invalid address format");
    }
  }

  private validatePageSize(pageSize?: number): number {
    const maxPageSize =
      this.configService.get<number>("TX_HISTORY_MAX_PAGE_SIZE") || 100;
    if (pageSize === undefined) {
      return Math.min(100, maxPageSize);
    }
    if (typeof pageSize !== "number" || pageSize < 1) {
      throw new BadRequestException("pageSize must be a positive number");
    }
    return Math.min(pageSize, maxPageSize);
  }

  private determineDirection(
    from: string,
    to: string,
    address: string
  ): "in" | "out" | "self" | "unknown" {
    const fromLower = from.toLowerCase();
    const toLower = to.toLowerCase();
    const addressLower = address.toLowerCase();

    if (fromLower === addressLower && toLower === addressLower) {
      return "self";
    }
    if (fromLower === addressLower) {
      return "out";
    }
    if (toLower === addressLower) {
      return "in";
    }
    return "unknown";
  }

  private normalizeTransfer(
    transfer: AlchemyTransfer,
    chainId: number,
    address: string
  ): TxItem {
    const direction = this.determineDirection(
      transfer.from,
      transfer.to,
      address
    );

    let value = "0";
    let symbol: string | undefined;
    let tokenAddress: string | undefined;

    if (transfer.category === "external") {
      // Native token transfer
      // Alchemy's transfer.value is already in decimal (ETH), but rawContract.value is in wei (hex)
      // Prefer rawContract.value for precision, but fall back to transfer.value
      if (transfer.rawContract?.value) {
        // Convert hex wei to decimal string
        const rawValue = BigInt(transfer.rawContract.value);
        const rawValueStr = rawValue.toString();
        if (rawValueStr === "0") {
          value = "0";
        } else {
          const decimals = 18; // Native tokens always use 18 decimals
          const padded = rawValueStr.padStart(decimals + 1, "0");
          const splitIndex = padded.length - decimals;
          const integerPart = padded.slice(0, splitIndex) || "0";
          const fractionalPart = padded.slice(splitIndex);
          value = `${integerPart}.${fractionalPart}`;
          // Remove trailing zeros
          value = value.replace(/\.?0+$/, "");
          if (value === "" || value === ".") {
            value = "0";
          }
        }
      } else if (transfer.value) {
        // Fallback: transfer.value is already in ETH (decimal), just format it
        value = transfer.value.toString();
        // Remove unnecessary trailing zeros
        value = value.replace(/\.?0+$/, "");
        if (value === "" || value === ".") {
          value = "0";
        }
      } else {
        value = "0";
      }
      symbol = "ETH"; // Could be chain-specific (ETH, MATIC, etc.)
    } else if (transfer.category === "erc20") {
      // ERC20 token
      const decimals = transfer.rawContract?.decimal
        ? parseInt(transfer.rawContract.decimal, 16)
        : 18;
      const rawValue = transfer.rawContract?.value
        ? BigInt(transfer.rawContract.value)
        : BigInt(0);
      
      // Convert BigInt to decimal string with proper precision
      const rawValueStr = rawValue.toString();
      if (rawValueStr === "0") {
        value = "0";
      } else {
        // Pad with zeros on the left if the number is smaller than the decimal places
        const padded = rawValueStr.padStart(decimals + 1, "0");
        // Insert decimal point: take everything except last 'decimals' digits as integer part
        const splitIndex = padded.length - decimals;
        const integerPart = padded.slice(0, splitIndex) || "0";
        const fractionalPart = padded.slice(splitIndex);
        value = `${integerPart}.${fractionalPart}`;
        // Remove trailing zeros but keep at least one digit after decimal if there's a decimal point
        value = value.replace(/\.?0+$/, "");
        // If we removed everything, it was zero
        if (value === "" || value === ".") {
          value = "0";
        }
      }
      
      tokenAddress = transfer.rawContract?.address?.toLowerCase();
      symbol = transfer.asset || "TOKEN";
    } else if (
      transfer.category === "erc721" ||
      transfer.category === "erc1155"
    ) {
      // NFT transfer
      value = transfer.tokenId || "1";
      tokenAddress = transfer.rawContract?.address?.toLowerCase();
      symbol = transfer.asset || "NFT";
    }

    const timestamp = transfer.metadata?.blockTimestamp
      ? new Date(transfer.metadata.blockTimestamp).toISOString()
      : new Date().toISOString();

    return {
      hash: transfer.hash,
      chainId,
      timestamp,
      direction,
      assetType:
        transfer.category === "external"
          ? "native"
          : (transfer.category as "erc20" | "erc721" | "erc1155"),
      from: transfer.from.toLowerCase(),
      to: transfer.to.toLowerCase(),
      value,
      symbol,
      tokenAddress,
      tokenId: transfer.tokenId,
      raw: transfer,
    };
  }

  async getTransactionHistory(
    chainId: number,
    address: string,
    pageKey?: string,
    pageSize?: number,
    fromBlock?: string,
    categories?: string[]
  ): Promise<TxHistoryResponse> {
    const startTime = Date.now();

    // Validate inputs
    if (!this.chainIdToKey[chainId]) {
      throw new BadRequestException(`Unsupported chainId: ${chainId}`);
    }

    this.validateAddress(address);
    const validatedPageSize = this.validatePageSize(pageSize);

    const defaultFromBlock =
      this.configService.get<string>("TX_HISTORY_DEFAULT_FROM_BLOCK") || "0x0";
    const fromBlockHex = fromBlock || defaultFromBlock;
    const transferCategories = categories || [
      "external",
      "erc20",
      "erc721",
      "erc1155",
    ];

    // Check cache
    const cacheKey = pageKey
      ? `txh:${chainId}:${address}:${pageKey}`
      : `txh:${chainId}:${address}:first`;
    const cached = await this.cacheManager.get<TxHistoryResponse>(cacheKey);
    if (cached) {
      this.logger.log(
        `Cache hit for ${chainId}:${address} (${Date.now() - startTime}ms)`
      );
      return cached;
    }

    // Call Alchemy
    const alchemyUrl = this.getAlchemyUrl(chainId);
    const alchemyParams: any = {
      fromBlock: fromBlockHex,
      category: transferCategories,
      withMetadata: true,
      excludeZeroValue: true,
      maxCount: `0x${validatedPageSize.toString(16)}`,
      order: "desc",
    };

    // For comprehensive history, fetch both inbound (toAddress) and outbound (fromAddress)
    // Note: Alchemy doesn't support both in one call, so we make two calls and merge
    // For pagination (pageKey provided), we only fetch the primary direction to maintain pagination state
    const addressLower = address.toLowerCase();

    if (pageKey) {
      // For pagination, continue with the primary direction (inbound)
      alchemyParams.toAddress = addressLower;
      alchemyParams.pageKey = pageKey;
    } else {
      // First page: fetch both directions
      alchemyParams.toAddress = addressLower;
    }

    try {
      // Fetch primary direction (inbound transfers)
      const response = await fetch(alchemyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "alchemy_getAssetTransfers",
          params: [alchemyParams],
        }),
      });

      // Check if response is OK and is JSON
      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Alchemy HTTP error for ${chainId}:${address}: ${response.status} ${errorText}`
        );
        throw new BadRequestException(
          `Alchemy API HTTP error: ${response.status}`
        );
      }

      let json;
      try {
        json = await response.json();
      } catch (e: any) {
        const errorText = await response.text().catch(() => "Unknown error");
        this.logger.error(
          `Alchemy JSON parse error for ${chainId}:${address}: ${errorText}`
        );
        throw new BadRequestException(
          `Alchemy API returned invalid JSON: ${errorText.substring(0, 100)}`
        );
      }

      if (json.error) {
        this.logger.error(
          `Alchemy error for ${chainId}:${address}: ${json.error.message}`
        );
        throw new BadRequestException(
          `Alchemy API error: ${json.error.message}`
        );
      }

      const alchemyData: AlchemyResponse = json.result;

      // Normalize transfers
      let items: TxItem[] = alchemyData.transfers.map((transfer) =>
        this.normalizeTransfer(transfer, chainId, address)
      );

      // For first page only, also fetch outbound transfers and merge
      if (!pageKey) {
        const outboundParams = { ...alchemyParams };
        delete outboundParams.toAddress;
        outboundParams.fromAddress = addressLower;
        delete outboundParams.pageKey; // Start fresh for outbound

        try {
          const outboundResponse = await fetch(alchemyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "alchemy_getAssetTransfers",
              params: [outboundParams],
            }),
          });

          if (!outboundResponse.ok) {
            const errorText = await outboundResponse.text();
            this.logger.warn(
              `Alchemy outbound HTTP error: ${outboundResponse.status} ${errorText}`
            );
          } else {
            let outboundJson;
            try {
              outboundJson = await outboundResponse.json();
            } catch (e: any) {
              const errorText = await outboundResponse.text().catch(() => "Unknown error");
              this.logger.warn(
                `Alchemy outbound JSON parse error: ${errorText}`
              );
            }
            
            if (outboundJson && !outboundJson.error && outboundJson.result) {
              const outboundData: AlchemyResponse = outboundJson.result;
              const outboundItems: TxItem[] = outboundData.transfers.map(
                (transfer) => this.normalizeTransfer(transfer, chainId, address)
              );
              items.push(...outboundItems);
            }
          }
        } catch (outboundError: any) {
          // Log but don't fail if outbound fetch fails
          this.logger.warn(
            `Failed to fetch outbound transfers: ${outboundError.message}`
          );
        }
      }

      // Sort by timestamp descending and deduplicate by hash
      const uniqueItems = Array.from(
        new Map(items.map((item) => [item.hash, item])).values()
      ).sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      const result: TxHistoryResponse = {
        items: uniqueItems.slice(0, validatedPageSize),
        nextPageKey: alchemyData.pageKey,
      };

      // Cache result
      const cacheTtl = pageKey ? 300 : 60; // 5 min for paginated, 1 min for first page
      await this.cacheManager.set(cacheKey, result, cacheTtl * 1000);

      const latency = Date.now() - startTime;
      this.logger.log(
        `Fetched ${result.items.length} transactions for ${chainId}:${address} (${latency}ms)`
      );

      return result;
    } catch (error: any) {
      this.logger.error(
        `Error fetching transaction history: ${error.message}`,
        error.stack
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to fetch transaction history: ${error.message}`
      );
    }
  }
}
