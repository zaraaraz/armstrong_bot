# [1.5.0](https://github.com/zaraaraz/armstrong_bot/compare/v1.4.3...v1.5.0) (2026-07-01)


### Features

* **dashboard:** build visual frontend + ship it in the deploy pipeline ([9dc1957](https://github.com/zaraaraz/armstrong_bot/commit/9dc19574861459f15aa6f54887cb52319533c9d1))

## [1.4.3](https://github.com/zaraaraz/armstrong_bot/compare/v1.4.2...v1.4.3) (2026-07-01)


### Bug Fixes

* **config:** parse boolean env vars correctly (session.secure) ([26554c4](https://github.com/zaraaraz/armstrong_bot/commit/26554c449f9c2e37a4e623b7459f5416d7693428))

## [1.4.2](https://github.com/zaraaraz/armstrong_bot/compare/v1.4.1...v1.4.2) (2026-07-01)


### Bug Fixes

* **ci:** make deploy idempotent — compose down before up ([114cc5f](https://github.com/zaraaraz/armstrong_bot/commit/114cc5ff346dd58440426c156bcbed576591f9fa))

## [1.4.1](https://github.com/zaraaraz/armstrong_bot/compare/v1.4.0...v1.4.1) (2026-07-01)


### Bug Fixes

* **ci:** checkout repo in deploy job so scp finds compose file ([1367abe](https://github.com/zaraaraz/armstrong_bot/commit/1367abee83b935083ba65989cdb8b29a00ba4723))

# [1.4.0](https://github.com/zaraaraz/armstrong_bot/compare/v1.3.0...v1.4.0) (2026-07-01)


### Bug Fixes

* **deploy:** make the app production-runnable + add auto-deploy pipeline ([a49f46a](https://github.com/zaraaraz/armstrong_bot/commit/a49f46accd62cb21cb947b106a0c9ad878ed32ec))
* **roadmap:** remove status indication for Scheduler item ([d8285ef](https://github.com/zaraaraz/armstrong_bot/commit/d8285ef006f9954438c21a0499e58424df1261da))


### Features

* **scheduler:** implement Scheduler module (item 13) ([72d0bd3](https://github.com/zaraaraz/armstrong_bot/commit/72d0bd30247950e67a2dc628add48e94ff3a2552))

# [1.3.0](https://github.com/zaraaraz/armstrong_bot/compare/v1.2.0...v1.3.0) (2026-06-30)


### Features

* **api,dashboard:** implement Phase 3 API & Dashboard backend (items 11-12) ([bae9673](https://github.com/zaraaraz/armstrong_bot/commit/bae9673b8fbd058b6145e34c870099825b65bc66))

# [1.2.0](https://github.com/zaraaraz/armstrong_bot/compare/v1.1.2...v1.2.0) (2026-06-30)


### Bug Fixes

* **testing:** fix pre-push typecheck and lint failures ([3183c95](https://github.com/zaraaraz/armstrong_bot/commit/3183c95fb5227a46ad2e5be75678992337e78844))
* update roadmap formatting and item descriptions for clarity ([e163586](https://github.com/zaraaraz/armstrong_bot/commit/e1635866cfc5ba813139abaefd079f4fae8609c4))


### Features

* **core-platform:** implement i18n and permissions core systems ([50babab](https://github.com/zaraaraz/armstrong_bot/commit/50babab547f7156146150b3e54c1ed918d164c29))
* **events:** implement asynchronous and synchronous event dispatchers ([09f7a7f](https://github.com/zaraaraz/armstrong_bot/commit/09f7a7f0215994e6f3f15ee6427dacc892d8cb08))
* **events:** wire @OnEvent decorator scanner into bootstrap ([515c0e4](https://github.com/zaraaraz/armstrong_bot/commit/515c0e455d91a251465666cdcac667ce3d5417f0)), closes [#6](https://github.com/zaraaraz/armstrong_bot/issues/6)
* **plugins:** implement core plugin system (item 9) ([3feb3da](https://github.com/zaraaraz/armstrong_bot/commit/3feb3da19308ca098a4659edc36468e21a7427c4))
* **security:** add cross-cutting @shared/security layer (core slice) ([23a4885](https://github.com/zaraaraz/armstrong_bot/commit/23a4885c023eeae303943b4011cbda391a874590))
* **testing:** implement testing infrastructure (item 10) ([01de668](https://github.com/zaraaraz/armstrong_bot/commit/01de6684329a7d1c4b3b79675463806d3affd0ad))

## [1.1.2](https://github.com/zaraaraz/armstrong_bot/compare/v1.1.1...v1.1.2) (2026-06-29)


### Bug Fixes

* update commitlint action to version 6 and modify test coverage script ([4b7dc72](https://github.com/zaraaraz/armstrong_bot/commit/4b7dc728eb1ae915967a523b1f5b0075316db42a))

## [1.1.1](https://github.com/zaraaraz/armstrong_bot/compare/v1.1.0...v1.1.1) (2026-06-29)


### Bug Fixes

* **ci:** update commitlint action to version 7 ([a05a4f7](https://github.com/zaraaraz/armstrong_bot/commit/a05a4f7434b8b774a1752d382d3e1400977a2705))

# [1.1.0](https://github.com/zaraaraz/armstrong_bot/compare/v1.0.0...v1.1.0) (2026-06-29)


### Features

* **database:** add deployment_records table with relevant fields and indexes ([2d2c86a](https://github.com/zaraaraz/armstrong_bot/commit/2d2c86adcbe012aa722c4ff1434ab0662b09738a))

# 1.0.0 (2026-06-29)


### Bug Fixes

* update CI and release workflows to include prisma generate step ([6345119](https://github.com/zaraaraz/armstrong_bot/commit/63451194183d481198e631dda027950a38fe94f7))
* update roadmap to include feature/core and feature/base phases ([1ffbbcc](https://github.com/zaraaraz/armstrong_bot/commit/1ffbbccc362d5107c929a30dc7bf1625a0488f1c))


### Features

* add comprehensive documentation for development processes including roadmap, branch strategy, coding standards, pull request process, and release process ([88bffdc](https://github.com/zaraaraz/armstrong_bot/commit/88bffdcd657a47af138db2d646457a0f3ed791fa))
* add initial README.md with project description, setup instructions, and resources ([04fa113](https://github.com/zaraaraz/armstrong_bot/commit/04fa1133809fb9bf30273515a1f4aa8946d8c5a6))
* add Webhooks module documentation and initial roadmap ([f468750](https://github.com/zaraaraz/armstrong_bot/commit/f4687506b30fd1f27a8ee8e466f96a2b50a39f01))
* **ci:** implement CI/CD pipeline with GitHub Actions ([97a23ec](https://github.com/zaraaraz/armstrong_bot/commit/97a23ecc7bd8c49b42f77a19439430a235c3e2d1))
* **core:** implement Core, Database, and Cache foundation layers ([81a3999](https://github.com/zaraaraz/armstrong_bot/commit/81a3999aa1f8746b7ed4c29b1bc07b6300df68ed))
