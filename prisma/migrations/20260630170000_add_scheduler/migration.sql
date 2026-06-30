-- CreateTable: schedules
CREATE TABLE `schedules` (
    `id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(20) NULL,
    `kind` VARCHAR(191) NOT NULL,
    `type` ENUM('once', 'recurring') NOT NULL,
    `status` ENUM('pending', 'active', 'paused', 'completed', 'cancelled', 'failed') NOT NULL DEFAULT 'pending',
    `payload` JSON NOT NULL,
    `idempotency_key` VARCHAR(191) NULL,
    `cron` VARCHAR(191) NULL,
    `every_ms` INTEGER NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
    `next_run_at` DATETIME(3) NULL,
    `last_run_at` DATETIME(3) NULL,
    `deferrable` BOOLEAN NOT NULL DEFAULT true,
    `max_attempts` INTEGER NOT NULL DEFAULT 5,
    `bull_job_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `schedules_guild_id_status_idx`(`guild_id`, `status`),
    INDEX `schedules_kind_status_idx`(`kind`, `status`),
    INDEX `schedules_next_run_at_idx`(`next_run_at`),
    INDEX `schedules_deleted_at_idx`(`deleted_at`),
    UNIQUE INDEX `schedules_guild_id_kind_idempotency_key_key`(`guild_id`, `kind`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: schedule_runs
CREATE TABLE `schedule_runs` (
    `id` VARCHAR(191) NOT NULL,
    `schedule_id` VARCHAR(191) NOT NULL,
    `guild_id` VARCHAR(20) NULL,
    `attempt` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('pending', 'active', 'paused', 'completed', 'cancelled', 'failed') NOT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `duration_ms` INTEGER NULL,
    `error` TEXT NULL,
    `trace_id` VARCHAR(191) NULL,

    INDEX `schedule_runs_schedule_id_started_at_idx`(`schedule_id`, `started_at`),
    INDEX `schedule_runs_guild_id_status_idx`(`guild_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `schedule_runs` ADD CONSTRAINT `schedule_runs_schedule_id_fkey` FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
