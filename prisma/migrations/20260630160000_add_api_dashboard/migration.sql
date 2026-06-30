-- CreateTable: webhook_deliveries
CREATE TABLE `webhook_deliveries` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `event_type` VARCHAR(128) NOT NULL,
    `guild_id` VARCHAR(20) NULL,
    `signature` VARCHAR(512) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'received',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `payload` JSON NOT NULL,
    `error` TEXT NULL,
    `request_id` VARCHAR(64) NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `webhook_deliveries_provider_event_type_idx`(`provider`, `event_type`),
    INDEX `webhook_deliveries_guild_id_idx`(`guild_id`),
    INDEX `webhook_deliveries_status_idx`(`status`),
    INDEX `webhook_deliveries_request_id_idx`(`request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: dashboard_sessions
CREATE TABLE `dashboard_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `discord_id` VARCHAR(20) NOT NULL,
    `username` VARCHAR(32) NOT NULL,
    `refresh_token` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,

    INDEX `dashboard_sessions_discord_id_idx`(`discord_id`),
    INDEX `dashboard_sessions_expires_at_idx`(`expires_at`),
    INDEX `dashboard_sessions_revoked_at_idx`(`revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: dashboard_backups
CREATE TABLE `dashboard_backups` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `job_id` VARCHAR(64) NULL,
    `size_bytes` BIGINT NULL,
    `storage_key` VARCHAR(512) NULL,
    `error` TEXT NULL,
    `requested_by` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `dashboard_backups_guild_id_status_idx`(`guild_id`, `status`),
    INDEX `dashboard_backups_created_at_idx`(`created_at`),
    INDEX `dashboard_backups_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: dashboard_audit_entries
CREATE TABLE `dashboard_audit_entries` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(20) NOT NULL,
    `actor_id` VARCHAR(20) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `target` VARCHAR(255) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dashboard_audit_entries_guild_id_created_at_idx`(`guild_id`, `created_at`),
    INDEX `dashboard_audit_entries_actor_id_idx`(`actor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
