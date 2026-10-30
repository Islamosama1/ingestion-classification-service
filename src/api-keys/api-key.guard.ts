import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { Env } from '../config/env';
import { IS_PUBLIC } from './public.decorator';

const sha256 = (value: string): Buffer =>
  createHash('sha256').update(value).digest();

// Global: every route needs X-API-Key = API_KEY unless marked @Public().
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    this.expected = sha256(config.get('API_KEY', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const given = context
      .switchToHttp()
      .getRequest<Request>()
      .header('x-api-key');
    // Hash both sides so the compare is constant-time whatever the length.
    if (!given || !timingSafeEqual(sha256(given), this.expected)) {
      // Same answer for missing and wrong keys.
      throw new UnauthorizedException('Missing or invalid API key');
    }
    return true;
  }
}
