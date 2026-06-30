-- CreateEnum
CREATE TABLE IF NOT EXISTS `_prisma_migrations` (`id` VARCHAR(36) NOT NULL, `checksum` VARCHAR(64) NOT NULL, `finished_at` DATETIME(3), `migration_name` VARCHAR(255) NOT NULL, `logs` TEXT, `rolled_back_at` DATETIME(3), `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `applied_steps_count` INT UNSIGNED NOT NULL DEFAULT 0, PRIMARY KEY (`id`)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterEnum (PluginScope)
-- AlterEnum (PluginStatus)

-- CreateTable: plugins
CREATE TABLE `plugins` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `display_name` VARCHAR(128) NOT NULL,
    `version` VARCHAR(32) NOT NULL,
    `author` VARCHAR(128) NOT NULL,
    `scope` ENUM('GUILD', 'GLOBAL') NOT NULL DEFAULT 'GUILD',
    `status` ENUM('INSTALLED', 'ENABLED', 'DISABLED', 'ERRORED', 'UPDATING', 'REMOVED') NOT NULL DEFAULT 'INSTALLED',
    `sdk_range` VARCHAR(64) NOT NULL,
    `checksum` VARCHAR(64) NULL,
    `manifest` JSON NOT NULL,
    `installed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `plugins_name_key`(`name`),
    INDEX `plugins_name_idx`(`name`),
    INDEX `plugins_status_idx`(`status`),
    INDEX `plugins_scope_idx`(`scope`),
    INDEX `plugins_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: plugin_enablements
CREATE TABLE `plugin_enablements` (
    `id` VARCHAR(191) NOT NULL,
    `plugin_id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(20) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `enabled_by` VARCHAR(20) NOT NULL,
    `enabled_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `plugin_enablements_guild_id_idx`(`guild_id`),
    INDEX `plugin_enablements_plugin_id_idx`(`plugin_id`),
    UNIQUE INDEX `plugin_enablements_plugin_id_guild_id_key`(`plugin_id`, `guild_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: plugin_configs
CREATE TABLE `plugin_configs` (
    `id` VARCHAR(191) NOT NULL,
    `plugin_id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(20) NULL,
    `values` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `plugin_configs_plugin_id_idx`(`plugin_id`),
    UNIQUE INDEX `plugin_configs_plugin_id_guild_id_key`(`plugin_id`, `guild_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: plugin_version_histories
CREATE TABLE `plugin_version_histories` (
    `id` VARCHAR(191) NOT NULL,
    `plugin_id` VARCHAR(191) NOT NULL,
    `from_version` VARCHAR(32) NULL,
    `to_version` VARCHAR(32) NOT NULL,
    `actor_id` VARCHAR(20) NOT NULL,
    `applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `plugin_version_histories_plugin_id_idx`(`plugin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey: plugin_enablements -> plugins
ALTER TABLE `plugin_enablements` ADD CONSTRAINT `plugin_enablements_plugin_id_fkey` FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: plugin_configs -> plugins
ALTER TABLE `plugin_configs` ADD CONSTRAINT `plugin_configs_plugin_id_fkey` FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: plugin_version_histories -> plugins
ALTER TABLE `plugin_version_histories` ADD CONSTRAINT `plugin_version_histories_plugin_id_fkey` FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
