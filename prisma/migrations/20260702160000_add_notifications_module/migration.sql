-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(32) NULL,
    `category` VARCHAR(64) NOT NULL,
    `priority` VARCHAR(16) NOT NULL DEFAULT 'normal',
    `template_key` VARCHAR(191) NOT NULL,
    `vars` JSON NOT NULL,
    `dedupe_key` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `notifications_guild_id_category_idx`(`guild_id`, `category`),
    INDEX `notifications_dedupe_key_idx`(`dedupe_key`),
    INDEX `notifications_created_at_idx`(`created_at`),
    INDEX `notifications_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_deliveries` (
    `id` VARCHAR(191) NOT NULL,
    `notification_id` VARCHAR(191) NOT NULL,
    `channel` ENUM('DISCORD_DM', 'DISCORD_CHANNEL', 'WEBHOOK', 'EMAIL', 'PUSH') NOT NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED', 'DEAD', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `recipient_user_id` VARCHAR(32) NULL,
    `recipient_ref` VARCHAR(512) NULL,
    `provider_message_id` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_error` TEXT NULL,
    `scheduled_for` DATETIME(3) NULL,
    `delivered_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notification_deliveries_notification_id_idx`(`notification_id`),
    INDEX `notification_deliveries_status_scheduled_for_idx`(`status`, `scheduled_for`),
    INDEX `notification_deliveries_channel_status_idx`(`channel`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(32) NOT NULL,
    `user_id` VARCHAR(32) NOT NULL,
    `category` VARCHAR(64) NOT NULL,
    `channel` ENUM('DISCORD_DM', 'DISCORD_CHANNEL', 'WEBHOOK', 'EMAIL', 'PUSH') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `notification_preferences_guild_id_user_id_idx`(`guild_id`, `user_id`),
    INDEX `notification_preferences_deleted_at_idx`(`deleted_at`),
    UNIQUE INDEX `notification_preferences_guild_id_user_id_category_channel_key`(`guild_id`, `user_id`, `category`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_templates` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(32) NULL,
    `key` VARCHAR(191) NOT NULL,
    `locale` VARCHAR(10) NOT NULL,
    `subject` VARCHAR(512) NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `notification_templates_key_locale_idx`(`key`, `locale`),
    INDEX `notification_templates_deleted_at_idx`(`deleted_at`),
    UNIQUE INDEX `notification_templates_guild_id_key_locale_key`(`guild_id`, `key`, `locale`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `integration_subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(32) NOT NULL,
    `provider` ENUM('TWITCH', 'YOUTUBE', 'GITHUB') NOT NULL,
    `external_id` VARCHAR(191) NOT NULL,
    `announce_channel_id` VARCHAR(32) NULL,
    `cursor` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `integration_subscriptions_provider_active_idx`(`provider`, `active`),
    INDEX `integration_subscriptions_deleted_at_idx`(`deleted_at`),
    UNIQUE INDEX `integration_subscriptions_guild_id_provider_external_id_key`(`guild_id`, `provider`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `notification_deliveries_notification_id_fkey` FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
