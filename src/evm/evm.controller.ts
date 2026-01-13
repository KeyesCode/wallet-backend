import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { EvmService, TxHistoryResponse } from "./evm.service";

@Controller("evm")
@UseGuards(ThrottlerGuard)
export class EvmController {
  constructor(private readonly evmService: EvmService) {}

  @Get(":chainId/tx-history")
  @HttpCode(HttpStatus.OK)
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
      throw new Error("Invalid chainId");
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
}
