-- CreateTable
CREATE TABLE `api_keys` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(20) NULL,
    `name` VARCHAR(64) NOT NULL,
    `hashed_key` VARCHAR(255) NOT NULL,
    `prefix` VARCHAR(16) NOT NULL,
    `scopes` TEXT NOT NULL,
    `last_used_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `api_keys_hashed_key_key`(`hashed_key`),
    INDEX `api_keys_guild_id_idx`(`guild_id`),
    INDEX `api_keys_prefix_idx`(`prefix`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `encryption_keys` (
    `id` VARCHAR(191) NOT NULL,
    `key_id` VARCHAR(64) NOT NULL,
    `state` ENUM('ACTIVE', 'RETIRING', 'RETIRED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `encryption_keys_key_id_key`(`key_id`),
    INDEX `encryption_keys_state_idx`(`state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
