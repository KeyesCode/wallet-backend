import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Header,
} from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { EvmService, TxHistoryResponse } from "./evm.service";

@Controller("evm")
@UseGuards(ThrottlerGuard)
export class EvmController {
  constructor(private readonly evmService: EvmService) {}

  @Get(":chainId/tx-history")
  @HttpCode(HttpStatus.OK)
  @Header("Content-Type", "application/json")
  async getTransactionHistory(
    @Param("chainId") chainId: string,
    @Query("address") address: string,
    @Query("pageKey") pageKey?: string,
    @Query("pageSize") pageSize?: string,
    @Query("fromBlock") fromBlock?: string,
    @Query("categories") categories?: string
  ): Promise<TxHistoryResponse> {
    const chainIdNum = parseInt(chainId, 10);
    if (isNaN(chainIdNum)) {
      throw new BadRequestException("Invalid chainId");
    }

    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : undefined;
    const categoriesArray = categories
      ? categories.split(",").map((c) => c.trim())
      : undefined;

    return this.evmService.getTransactionHistory(
      chainIdNum,
      address,
      pageKey,
      pageSizeNum,
      fromBlock,
      categoriesArray
    );
  }

  @Post(":chainId/rpc")
  @HttpCode(HttpStatus.OK)
  @Header("Content-Type", "application/json")
  async proxyRpc(
    @Param("chainId") chainId: string,
    @Body() body: { method: string; params: any[] }
  ): Promise<any> {
    const chainIdNum = parseInt(chainId, 10);
    if (isNaN(chainIdNum)) {
      throw new BadRequestException("Invalid chainId");
    }

    if (!body.method || !Array.isArray(body.params)) {
      throw new BadRequestException("Invalid RPC request: method and params required");
    }

    return this.evmService.proxyRpcCall(chainIdNum, body.method, body.params);
  }
}
