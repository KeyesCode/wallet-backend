import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { EvmController } from "./evm/evm.controller";
import { EvmService } from "./evm/evm.service";
import { CacheModule } from "@nestjs/cache-manager";
import { memoryStore } from "cache-manager";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 60, // 60 requests per minute per IP
      },
    ]),
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => {
        const store = await memoryStore({
          max: 1000,
          ttl: 60 * 1000, // milliseconds
        });
        return {
          store: store,
          ttl: 60, // 60 seconds default
          max: 1000, // max 1000 items in cache
        };
      },
    }),
  ],
  controllers: [EvmController],
  providers: [EvmService],
})
export class AppModule {}
