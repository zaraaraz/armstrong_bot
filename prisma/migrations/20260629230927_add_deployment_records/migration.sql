-- CreateTable
CREATE TABLE `deployment_records` (
    `id` VARCHAR(191) NOT NULL,
    `environment` ENUM('STAGING', 'PRODUCTION') NOT NULL,
    `version` VARCHAR(50) NOT NULL,
    `git_sha` VARCHAR(40) NOT NULL,
    `image_tag` VARCHAR(255) NOT NULL,
    `status` ENUM('STARTED', 'SUCCEEDED', 'FAILED', 'ROLLED_BACK') NOT NULL,
    `duration_ms` INTEGER NOT NULL,
    `rolled_back` BOOLEAN NOT NULL DEFAULT false,
    `trace_id` VARCHAR(64) NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `deployment_records_environment_created_at_idx`(`environment`, `created_at`),
    INDEX `deployment_records_version_idx`(`version`),
    INDEX `deployment_records_git_sha_idx`(`git_sha`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
