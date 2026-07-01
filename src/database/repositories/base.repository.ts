import { PrismaService } from '../prisma.service';
import type { FindOptions, PageQuery, PaginatedResult } from './base.types';
import type { RepositoryContext } from '../transactions/transaction.context';

export class EntityNotFoundError extends Error {
  constructor(model: string, id: string) {
    super(`${model} with id "${id}" not found`);
    this.name = 'EntityNotFoundError';
  }
}

export interface DelegateLike<TModel> {
  findFirst(args: { where: object }): Promise<TModel | null>;
  findMany(args: {
    where?: object;
    skip?: number;
    take?: number;
    orderBy?: object;
  }): Promise<TModel[]>;
  count(args: { where?: object }): Promise<number>;
  create(args: { data: object }): Promise<TModel>;
  update(args: { where: object; data: object }): Promise<TModel>;
  delete(args: { where: object }): Promise<TModel>;
}

export type CreateInput<T> = Omit<
  T,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;
export type UpdateInput<T> = Partial<CreateInput<T>>;
export type WhereInput<T> = Partial<Record<keyof T, unknown>>;

export abstract class BaseRepository<
  TModel extends { id: string; deletedAt: Date | null },
  TDelegate extends DelegateLike<TModel>,
> {
  protected constructor(protected readonly prisma: PrismaService) {}

  protected abstract delegate(ctx?: RepositoryContext): TDelegate;
  protected abstract get modelName(): string;

  protected notDeleted(withDeleted?: boolean): object {
    return withDeleted ? {} : { deletedAt: null };
  }

  async findById(
    id: string,
    options?: FindOptions,
    ctx?: RepositoryContext,
  ): Promise<TModel | null> {
    return this.delegate(ctx).findFirst({
      where: { id, ...this.notDeleted(options?.withDeleted) },
    });
  }

  async findByIdOrThrow(
    id: string,
    options?: FindOptions,
    ctx?: RepositoryContext,
  ): Promise<TModel> {
    const found = await this.findById(id, options, ctx);
    if (!found) throw new EntityNotFoundError(this.modelName, id);
    return found;
  }

  async create(
    data: CreateInput<TModel>,
    ctx?: RepositoryContext,
  ): Promise<TModel> {
    return this.delegate(ctx).create({ data: data });
  }

  async update(
    id: string,
    data: UpdateInput<TModel>,
    ctx?: RepositoryContext,
  ): Promise<TModel> {
    return this.delegate(ctx).update({ where: { id }, data: data });
  }

  async softDelete(id: string, ctx?: RepositoryContext): Promise<TModel> {
    return this.delegate(ctx).update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string, ctx?: RepositoryContext): Promise<TModel> {
    return this.delegate(ctx).update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  async hardDelete(
    id: string,
    force: true,
    ctx?: RepositoryContext,
  ): Promise<TModel> {
    void force;
    return this.delegate(ctx).delete({ where: { id } });
  }

  async paginate(
    query: PageQuery,
    where: WhereInput<TModel> = {},
    options?: FindOptions,
    ctx?: RepositoryContext,
  ): Promise<PaginatedResult<TModel>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const fullWhere = { ...where, ...this.notDeleted(options?.withDeleted) };
    const delegate = this.delegate(ctx);

    const [items, total] = await Promise.all([
      delegate.findMany({
        where: fullWhere,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: query.orderBy
          ? { [query.orderBy]: query.direction ?? 'desc' }
          : undefined,
      }),
      delegate.count({ where: fullWhere }),
    ]);

    const totalPages = Math.ceil(total / pageSize) || 1;
    return {
      items,
      total,
      page,
      pageSize,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }
}
