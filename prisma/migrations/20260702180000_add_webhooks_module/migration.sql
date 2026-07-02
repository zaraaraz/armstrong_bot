-- CreateTable
CREATE TABLE `webhook_endpoints` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(32) NULL,
    `provider` ENUM('github', 'stripe', 'fivem', 'custom') NOT NULL,
    `token` VARCHAR(64) NOT NULL,
    `signing_secret` TEXT NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_by_id` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `webhook_endpoints_token_key`(`token`),
    INDEX `webhook_endpoints_guild_id_provider_idx`(`guild_id`, `provider`),
    INDEX `webhook_endpoints_enabled_idx`(`enabled`),
    INDEX `webhook_endpoints_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_ingress_deliveries` (
    `id` VARCHAR(191) NOT NULL,
    `endpoint_id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(32) NULL,
    `provider` ENUM('github', 'stripe', 'fivem', 'custom') NOT NULL,
    `external_id` VARCHAR(191) NULL,
    `event_type` VARCHAR(191) NULL,
    `status` ENUM('received', 'verified', 'rejected', 'processing', 'processed', 'failed', 'dead_lettered') NOT NULL DEFAULT 'received',
    `raw_body` LONGBLOB NOT NULL,
    `headers` JSON NOT NULL,
    `reject_reason` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,

    INDEX `webhook_ingress_deliveries_guild_id_status_idx`(`guild_id`, `status`),
    INDEX `webhook_ingress_deliveries_provider_event_type_idx`(`provider`, `event_type`),
    INDEX `webhook_ingress_deliveries_received_at_idx`(`received_at`),
    UNIQUE INDEX `webhook_ingress_deliveries_endpoint_id_external_id_key`(`endpoint_id`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(32) NOT NULL,
    `event_type` VARCHAR(191) NOT NULL,
    `target_url` TEXT NOT NULL,
    `signing_secret` TEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `filter` JSON NULL,
    `created_by_id` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `webhook_subscriptions_guild_id_event_type_enabled_idx`(`guild_id`, `event_type`, `enabled`),
    INDEX `webhook_subscriptions_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_outbound_deliveries` (
    `id` VARCHAR(191) NOT NULL,
    `subscription_id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(32) NOT NULL,
    `event_type` VARCHAR(191) NOT NULL,
    `status` ENUM('received', 'verified', 'rejected', 'processing', 'processed', 'failed', 'dead_lettered') NOT NULL DEFAULT 'processing',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_status_code` INTEGER NULL,
    `last_error` TEXT NULL,
    `payload` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `delivered_at` DATETIME(3) NULL,

    INDEX `webhook_outbound_deliveries_subscription_id_status_idx`(`subscription_id`, `status`),
    INDEX `webhook_outbound_deliveries_guild_id_event_type_idx`(`guild_id`, `event_type`),
    INDEX `webhook_outbound_deliveries_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `webhook_ingress_deliveries` ADD CONSTRAINT `webhook_ingress_deliveries_endpoint_id_fkey` FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_outbound_deliveries` ADD CONSTRAINT `webhook_outbound_deliveries_subscription_id_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `webhook_subscriptions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
