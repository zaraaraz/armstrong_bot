-- CreateTable
CREATE TABLE `log_configs` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(32) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `default_channel_id` VARCHAR(32) NULL,
    `ignore_bots` BOOLEAN NOT NULL DEFAULT true,
    `embed_color_override` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `log_configs_guild_id_key`(`guild_id`),
    INDEX `log_configs_guild_id_idx`(`guild_id`),
    INDEX `log_configs_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `log_routes` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(32) NOT NULL,
    `category` ENUM('MESSAGE_DELETE', 'MESSAGE_EDIT', 'VOICE', 'ROLE_UPDATE', 'NICKNAME', 'CHANNEL', 'MEMBER_JOIN', 'MEMBER_LEAVE', 'BAN', 'TIMEOUT', 'TICKET', 'COMMAND_USAGE', 'ERROR') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `channel_id` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `log_routes_guild_id_idx`(`guild_id`),
    INDEX `log_routes_guild_id_category_idx`(`guild_id`, `category`),
    UNIQUE INDEX `log_routes_guild_id_category_key`(`guild_id`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `log_ignore_rules` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(32) NOT NULL,
    `type` ENUM('USER', 'ROLE', 'CHANNEL', 'COMMAND') NOT NULL,
    `value` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `log_ignore_rules_guild_id_type_idx`(`guild_id`, `type`),
    UNIQUE INDEX `log_ignore_rules_guild_id_type_value_key`(`guild_id`, `type`, `value`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `log_audit_entries` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(32) NOT NULL,
    `category` ENUM('MESSAGE_DELETE', 'MESSAGE_EDIT', 'VOICE', 'ROLE_UPDATE', 'NICKNAME', 'CHANNEL', 'MEMBER_JOIN', 'MEMBER_LEAVE', 'BAN', 'TIMEOUT', 'TICKET', 'COMMAND_USAGE', 'ERROR') NOT NULL,
    `actor_id` VARCHAR(32) NULL,
    `target_id` VARCHAR(32) NULL,
    `channel_id` VARCHAR(32) NULL,
    `message_id` VARCHAR(32) NULL,
    `correlation_id` VARCHAR(191) NULL,
    `payload` JSON NOT NULL,
    `dispatched` BOOLEAN NOT NULL DEFAULT false,
    `failure_reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `log_audit_entries_guild_id_category_idx`(`guild_id`, `category`),
    INDEX `log_audit_entries_guild_id_created_at_idx`(`guild_id`, `created_at`),
    INDEX `log_audit_entries_correlation_id_idx`(`correlation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `log_routes` ADD CONSTRAINT `log_routes_guild_id_fkey` FOREIGN KEY (`guild_id`) REFERENCES `log_configs`(`guild_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `log_ignore_rules` ADD CONSTRAINT `log_ignore_rules_guild_id_fkey` FOREIGN KEY (`guild_id`) REFERENCES `log_configs`(`guild_id`) ON DELETE CASCADE ON UPDATE CASCADE;
