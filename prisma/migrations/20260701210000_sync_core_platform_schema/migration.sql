-- AlterTable
ALTER TABLE `dashboard_audit_entries` MODIFY `metadata` JSON NULL;

-- AlterTable
ALTER TABLE `guild_configs` MODIFY `settings` JSON NOT NULL DEFAULT ('{}');

-- AlterTable
ALTER TABLE `guild_members` MODIFY `role_ids` JSON NOT NULL DEFAULT ('[]');

-- AlterTable
ALTER TABLE `module_registrations` MODIFY `permissions` JSON NOT NULL,
    MODIFY `emits` JSON NOT NULL,
    MODIFY `consumes` JSON NOT NULL;

-- AlterTable
ALTER TABLE `plugin_configs` MODIFY `values` JSON NOT NULL;

-- AlterTable
ALTER TABLE `plugins` MODIFY `manifest` JSON NOT NULL;

-- AlterTable
ALTER TABLE `schedule_runs` MODIFY `guild_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `schedules` MODIFY `guild_id` VARCHAR(191) NULL,
    MODIFY `payload` JSON NOT NULL;

-- AlterTable
ALTER TABLE `webhook_deliveries` MODIFY `payload` JSON NOT NULL;

-- CreateTable
CREATE TABLE `translations` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(191) NULL,
    `locale` VARCHAR(10) NOT NULL,
    `module` VARCHAR(64) NOT NULL,
    `namespace` VARCHAR(64) NOT NULL,
    `key` VARCHAR(255) NOT NULL,
    `value` TEXT NOT NULL,
    `updated_by` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `translations_locale_module_namespace_idx`(`locale`, `module`, `namespace`),
    INDEX `translations_guild_id_locale_idx`(`guild_id`, `locale`),
    INDEX `translations_deleted_at_idx`(`deleted_at`),
    UNIQUE INDEX `translations_guild_id_locale_module_namespace_key_key`(`guild_id`, `locale`, `module`, `namespace`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `locales` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `display_name` VARCHAR(64) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `locales_code_key`(`code`),
    INDEX `locales_enabled_idx`(`enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_locale_preferences` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(20) NOT NULL,
    `guild_id` VARCHAR(20) NULL,
    `locale` VARCHAR(10) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_locale_preferences_user_id_idx`(`user_id`),
    UNIQUE INDEX `user_locale_preferences_user_id_guild_id_key`(`user_id`, `guild_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permission_groups` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `permission_groups_guild_id_idx`(`guild_id`),
    INDEX `permission_groups_guild_id_deleted_at_idx`(`guild_id`, `deleted_at`),
    UNIQUE INDEX `permission_groups_guild_id_key_key`(`guild_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `claim_grants` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(191) NOT NULL,
    `group_id` VARCHAR(191) NOT NULL,
    `claim` VARCHAR(255) NOT NULL,
    `effect` ENUM('GRANT', 'DENY') NOT NULL DEFAULT 'GRANT',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `claim_grants_guild_id_idx`(`guild_id`),
    INDEX `claim_grants_guild_id_claim_idx`(`guild_id`, `claim`),
    UNIQUE INDEX `claim_grants_group_id_claim_key`(`group_id`, `claim`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_group_mappings` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(191) NOT NULL,
    `discord_role_id` VARCHAR(20) NOT NULL,
    `group_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `role_group_mappings_guild_id_idx`(`guild_id`),
    INDEX `role_group_mappings_guild_id_discord_role_id_idx`(`guild_id`, `discord_role_id`),
    UNIQUE INDEX `role_group_mappings_guild_id_discord_role_id_group_id_key`(`guild_id`, `discord_role_id`, `group_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_inheritances` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(191) NOT NULL,
    `child_group_id` VARCHAR(191) NOT NULL,
    `parent_group_id` VARCHAR(191) NOT NULL,

    INDEX `group_inheritances_guild_id_idx`(`guild_id`),
    UNIQUE INDEX `group_inheritances_child_group_id_parent_group_id_key`(`child_group_id`, `parent_group_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_logs` (
    `id` VARCHAR(191) NOT NULL,
    `envelope_id` VARCHAR(191) NOT NULL,
    `event_name` VARCHAR(128) NOT NULL,
    `guild_id` VARCHAR(20) NULL,
    `actor_type` VARCHAR(20) NOT NULL,
    `actor_id` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `correlation_id` VARCHAR(64) NOT NULL,
    `causation_id` VARCHAR(64) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `delivery` VARCHAR(10) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'published',
    `occurred_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `event_logs_envelope_id_key`(`envelope_id`),
    INDEX `event_logs_event_name_idx`(`event_name`),
    INDEX `event_logs_guild_id_idx`(`guild_id`),
    INDEX `event_logs_correlation_id_idx`(`correlation_id`),
    INDEX `event_logs_status_idx`(`status`),
    INDEX `event_logs_occurred_at_idx`(`occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_dead_letters` (
    `id` VARCHAR(191) NOT NULL,
    `envelope_id` VARCHAR(64) NOT NULL,
    `event_name` VARCHAR(128) NOT NULL,
    `guild_id` VARCHAR(20) NULL,
    `handler_id` VARCHAR(128) NOT NULL,
    `payload` JSON NOT NULL,
    `attempts` INTEGER NOT NULL,
    `last_error` TEXT NOT NULL,
    `error_code` VARCHAR(64) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `replayed_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `event_dead_letters_event_name_idx`(`event_name`),
    INDEX `event_dead_letters_handler_id_idx`(`handler_id`),
    INDEX `event_dead_letters_status_idx`(`status`),
    INDEX `event_dead_letters_guild_id_idx`(`guild_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `test_runs` (
    `id` VARCHAR(191) NOT NULL,
    `commit_sha` VARCHAR(40) NOT NULL,
    `branch` VARCHAR(255) NOT NULL,
    `suite` ENUM('UNIT', 'INTEGRATION', 'CONTRACT', 'E2E') NOT NULL,
    `passed` INTEGER NOT NULL,
    `failed` INTEGER NOT NULL,
    `skipped` INTEGER NOT NULL DEFAULT 0,
    `duration_ms` INTEGER NOT NULL,
    `coverage_lines` DECIMAL(5, 2) NULL,
    `coverage_branches` DECIMAL(5, 2) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `test_runs_commit_sha_idx`(`commit_sha`),
    INDEX `test_runs_branch_created_at_idx`(`branch`, `created_at`),
    INDEX `test_runs_suite_created_at_idx`(`suite`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `translations` ADD CONSTRAINT `translations_guild_id_fkey` FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `claim_grants` ADD CONSTRAINT `claim_grants_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `permission_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_group_mappings` ADD CONSTRAINT `role_group_mappings_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `permission_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_inheritances` ADD CONSTRAINT `group_inheritances_child_group_id_fkey` FOREIGN KEY (`child_group_id`) REFERENCES `permission_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_inheritances` ADD CONSTRAINT `group_inheritances_parent_group_id_fkey` FOREIGN KEY (`parent_group_id`) REFERENCES `permission_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_dead_letters` ADD CONSTRAINT `event_dead_letters_envelope_id_fkey` FOREIGN KEY (`envelope_id`) REFERENCES `event_logs`(`envelope_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

