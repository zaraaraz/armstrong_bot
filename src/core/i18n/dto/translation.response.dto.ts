export interface TranslationResponseDto {
  id: string;
  guildId: string | null;
  locale: string;
  module: string;
  namespace: string;
  key: string;
  value: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface PaginatedTranslationsDto {
  items: TranslationResponseDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LocaleResponseDto {
  code: string;
  displayName: string;
  enabled: boolean;
  isDefault: boolean;
}
