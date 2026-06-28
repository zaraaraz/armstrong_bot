export interface PageQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly orderBy?: string;
  readonly direction?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
}

export interface FindOptions {
  readonly withDeleted?: boolean;
}
