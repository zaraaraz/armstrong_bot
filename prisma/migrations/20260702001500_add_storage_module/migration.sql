-- CreateTable
CREATE TABLE `storage_objects` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(191) NULL,
    `namespace` ENUM('TRANSCRIPTS', 'BACKUPS', 'RANK_CARDS', 'EXPORTS', 'PLUGIN') NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `content_hash` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `content_type` VARCHAR(191) NOT NULL,
    `filename` VARCHAR(191) NULL,
    `owner_type` VARCHAR(191) NOT NULL,
    `owner_id` VARCHAR(191) NOT NULL,
    `immutable` BOOLEAN NOT NULL DEFAULT true,
    `ref_count` INTEGER NOT NULL DEFAULT 1,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `storage_objects_guild_id_namespace_idx`(`guild_id`, `namespace`),
    INDEX `storage_objects_content_hash_idx`(`content_hash`),
    INDEX `storage_objects_owner_type_owner_id_idx`(`owner_type`, `owner_id`),
    INDEX `storage_objects_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `storage_usage` (
    `guild_id` VARCHAR(191) NOT NULL,
    `used_bytes` BIGINT NOT NULL DEFAULT 0,
    `object_count` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`guild_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
