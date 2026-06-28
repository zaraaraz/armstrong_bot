-- CreateTable
CREATE TABLE `guilds` (
    `id` VARCHAR(191) NOT NULL,
    `discord_id` VARCHAR(20) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `icon_hash` VARCHAR(64) NULL,
    `owner_id` VARCHAR(20) NOT NULL,
    `locale` VARCHAR(10) NOT NULL DEFAULT 'pt',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `guilds_discord_id_key`(`discord_id`),
    INDEX `guilds_active_idx`(`active`),
    INDEX `guilds_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guild_configs` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(191) NOT NULL,
    `prefix` VARCHAR(10) NOT NULL DEFAULT '!',
    `locale` VARCHAR(10) NOT NULL DEFAULT 'pt',
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Europe/Lisbon',
    `settings` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `guild_configs_guild_id_key`(`guild_id`),
    INDEX `guild_configs_guild_id_idx`(`guild_id`),
    INDEX `guild_configs_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `discord_id` VARCHAR(20) NOT NULL,
    `username` VARCHAR(32) NOT NULL,
    `global_name` VARCHAR(32) NULL,
    `avatar_hash` VARCHAR(64) NULL,
    `bot` BOOLEAN NOT NULL DEFAULT false,
    `locale` VARCHAR(10) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `users_discord_id_key`(`discord_id`),
    INDEX `users_username_idx`(`username`),
    INDEX `users_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guild_members` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `nickname` VARCHAR(32) NULL,
    `role_ids` JSON NOT NULL,
    `joined_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `guild_members_guild_id_idx`(`guild_id`),
    INDEX `guild_members_user_id_idx`(`user_id`),
    INDEX `guild_members_deleted_at_idx`(`deleted_at`),
    UNIQUE INDEX `guild_members_guild_id_user_id_key`(`guild_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `module_registrations` (
    `id` VARCHAR(191) NOT NULL,
    `module_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `version` VARCHAR(20) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `guild_scoped` BOOLEAN NOT NULL DEFAULT true,
    `permissions` JSON NOT NULL,
    `emits` JSON NOT NULL,
    `consumes` JSON NOT NULL,
    `last_boot_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `module_registrations_module_id_key`(`module_id`),
    INDEX `module_registrations_enabled_idx`(`enabled`),
    INDEX `module_registrations_module_id_idx`(`module_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `module_lifecycle_events` (
    `id` VARCHAR(191) NOT NULL,
    `registration_id` VARCHAR(191) NOT NULL,
    `phase` VARCHAR(50) NOT NULL,
    `detail` TEXT NULL,
    `trace_id` VARCHAR(64) NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `module_lifecycle_events_registration_id_idx`(`registration_id`),
    INDEX `module_lifecycle_events_phase_idx`(`phase`),
    INDEX `module_lifecycle_events_occurred_at_idx`(`occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cache_settings` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(191) NULL,
    `ttl_multiplier` DOUBLE NOT NULL DEFAULT 1,
    `disabled` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `cache_settings_guild_id_idx`(`guild_id`),
    INDEX `cache_settings_deleted_at_idx`(`deleted_at`),
    UNIQUE INDEX `cache_settings_guild_id_key`(`guild_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `guild_configs` ADD CONSTRAINT `guild_configs_guild_id_fkey` FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guild_members` ADD CONSTRAINT `guild_members_guild_id_fkey` FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guild_members` ADD CONSTRAINT `guild_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `module_lifecycle_events` ADD CONSTRAINT `module_lifecycle_events_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `module_registrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
