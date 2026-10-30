import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

// Marks a route (or controller) as open: no X-API-Key needed.
export const Public = () => SetMetadata(IS_PUBLIC, true);
