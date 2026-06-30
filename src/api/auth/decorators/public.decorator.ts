import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'ghost:api:public';

/** Marks a route as accessible without authentication (e.g. /auth/login, /health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
