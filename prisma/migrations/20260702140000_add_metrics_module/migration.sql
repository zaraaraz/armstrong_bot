-- CreateTable
CREATE TABLE `metric_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `scope` ENUM('SYSTEM', 'GATEWAY', 'API', 'DATABASE', 'CACHE', 'QUEUE', 'COMMANDS') NOT NULL,
    `guild_id` VARCHAR(32) NULL,
    `captured_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `values` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `metric_snapshots_scope_captured_at_idx`(`scope`, `captured_at`),
    INDEX `metric_snapshots_guild_id_scope_captured_at_idx`(`guild_id`, `scope`, `captured_at`),
    INDEX `metric_snapshots_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `metric_threshold_overrides` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(32) NOT NULL,
    `metric` VARCHAR(191) NOT NULL,
    `comparator` ENUM('GT', 'LT', 'GTE', 'LTE') NOT NULL,
    `value` DOUBLE NOT NULL,
    `severity` ENUM('WARNING', 'CRITICAL') NOT NULL DEFAULT 'WARNING',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `metric_threshold_overrides_guild_id_enabled_idx`(`guild_id`, `enabled`),
    UNIQUE INDEX `metric_threshold_overrides_guild_id_metric_key`(`guild_id`, `metric`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
