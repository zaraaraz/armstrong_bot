-- CreateTable
CREATE TABLE `audit_entries` (
    `id` VARCHAR(191) NOT NULL,
    `scope` ENUM('GUILD', 'GLOBAL') NOT NULL,
    `guild_id` VARCHAR(32) NULL,
    `seq` BIGINT NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `source` ENUM('COMMAND', 'DASHBOARD', 'API', 'JOB', 'SYSTEM', 'EVENT') NOT NULL,
    `actor_id` VARCHAR(64) NULL,
    `actor_type` ENUM('USER', 'SYSTEM', 'BOT') NOT NULL,
    `target_type` VARCHAR(64) NULL,
    `target_id` VARCHAR(191) NULL,
    `channel_id` VARCHAR(32) NULL,
    `correlation_id` VARCHAR(64) NOT NULL,
    `causation_id` VARCHAR(64) NULL,
    `summary` VARCHAR(255) NOT NULL,
    `metadata` JSON NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `previous_hash` CHAR(128) NULL,
    `hash` CHAR(128) NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `audit_entries_hash_key`(`hash`),
    UNIQUE INDEX `audit_entries_scope_guild_id_seq_key`(`scope`, `guild_id`, `seq`),
    INDEX `audit_entries_guild_id_occurred_at_idx`(`guild_id`, `occurred_at`),
    INDEX `audit_entries_guild_id_action_idx`(`guild_id`, `action`),
    INDEX `audit_entries_actor_id_idx`(`actor_id`),
    INDEX `audit_entries_correlation_id_idx`(`correlation_id`),
    INDEX `audit_entries_target_type_target_id_idx`(`target_type`, `target_id`),
    INDEX `audit_entries_occurred_at_idx`(`occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_archives` (
    `id` VARCHAR(191) NOT NULL,
    `scope` ENUM('GUILD', 'GLOBAL') NOT NULL,
    `guild_id` VARCHAR(32) NULL,
    `format` VARCHAR(16) NOT NULL,
    `from_seq` BIGINT NOT NULL,
    `to_seq` BIGINT NOT NULL,
    `entry_count` INTEGER NOT NULL,
    `byte_size` INTEGER NOT NULL,
    `storage_ref` VARCHAR(512) NOT NULL,
    `root_hash` CHAR(128) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_archives_guild_id_created_at_idx`(`guild_id`, `created_at`),
    INDEX `audit_archives_scope_guild_id_to_seq_idx`(`scope`, `guild_id`, `to_seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
