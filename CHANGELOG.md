# Changelog

## [0.1.13](https://github.com/mctlhq/mctl-academy/compare/0.1.12...0.1.13) (2026-08-07)


### Features

* **api:** implement Hono backend server and Question Report intake API ([71c7496](https://github.com/mctlhq/mctl-academy/commit/71c74967102db7d3490ad1ac4fdd30290ff4129e))
* **api:** implement Hono backend server and Question Report intake API ([6d7313a](https://github.com/mctlhq/mctl-academy/commit/6d7313aafb35e1c5e116e820708eaf6626a2352a))

## [0.1.12](https://github.com/mctlhq/mctl-academy/compare/0.1.11...0.1.12) (2026-08-07)


### Bug Fixes

* **ci:** install root deps for build scripts and add mock-bundle to pre-hooks ([de99cd9](https://github.com/mctlhq/mctl-academy/commit/de99cd9f41a6f306765da9e5bbacca1bd3e4180e))
* **docker:** add build-mock-bundle.mjs to generate mock exam data at build time ([51430dd](https://github.com/mctlhq/mctl-academy/commit/51430dd5e95542208714f6c318da03a79853ab6b))
* **docker:** add build-mock-bundle.mjs to generate mock exam data at build time ([fce7dd0](https://github.com/mctlhq/mctl-academy/commit/fce7dd0063c8a6039b994b65e8f51caa1d20053a))
* **repo:** sync release-please manifest and package version to 0.1.11 ([7030a74](https://github.com/mctlhq/mctl-academy/commit/7030a74d9fc2a6786c0c0e564859c6b1f1dd27de))
* **repo:** sync release-please manifest and package version to 0.1.11 ([5f91697](https://github.com/mctlhq/mctl-academy/commit/5f91697654bd4659b41bfa27d625ce894e667da6))

## [0.1.3](https://github.com/mctlhq/mctl-academy/compare/0.1.2...0.1.3) (2026-08-07)


### Features

* **agents:** issue-20-feat-ui-implement-mock-exam-screen-30-qu ([a945a15](https://github.com/mctlhq/mctl-academy/commit/a945a15ae2ec62d49177177948b19f0aa68a4ba1))
* **agents:** issue-20-feat-ui-implement-mock-exam-screen-30-qu ([3794c76](https://github.com/mctlhq/mctl-academy/commit/3794c76614e5a9b934d57115230c09ad61477613))
* **ui:** merge practice mode ([#19](https://github.com/mctlhq/mctl-academy/issues/19)) and mock exam ([#20](https://github.com/mctlhq/mctl-academy/issues/20)) UI into unified app ([c4c0c3c](https://github.com/mctlhq/mctl-academy/commit/c4c0c3c0e4b72bcfdd890d9bda16a1aa3ad6d364))


### Bug Fixes

* **ci:** install root deps for build scripts and add mock-bundle to pre-hooks ([de99cd9](https://github.com/mctlhq/mctl-academy/commit/de99cd9f41a6f306765da9e5bbacca1bd3e4180e))
* **client:** clean up test setup files ([917527b](https://github.com/mctlhq/mctl-academy/commit/917527b48d9308d6beacb4c00aef4b2343f14357))
* **client:** fix prebuild script path ([2cacf80](https://github.com/mctlhq/mctl-academy/commit/2cacf80d05ac5ea0f455b096f9256d431e8963a6))
* **client:** unify test-setup files into single file ([7106cc9](https://github.com/mctlhq/mctl-academy/commit/7106cc9914ff957d3da58a705dd2a3d655f01fef))
* **client:** use correct relative path ../scripts/build-content-bundle.mjs in prebuild ([4b3a4c8](https://github.com/mctlhq/mctl-academy/commit/4b3a4c8bfbf769364c6f0ae5a9823711e7578576))
* **docker:** add build-mock-bundle.mjs to generate mock exam data at build time ([51430dd](https://github.com/mctlhq/mctl-academy/commit/51430dd5e95542208714f6c318da03a79853ab6b))
* **docker:** add build-mock-bundle.mjs to generate mock exam data at build time ([fce7dd0](https://github.com/mctlhq/mctl-academy/commit/fce7dd0063c8a6039b994b65e8f51caa1d20053a))
* **docker:** build and serve React client app ([b96bc22](https://github.com/mctlhq/mctl-academy/commit/b96bc2245497b5999ab31c0e6f09689168154ab4))
* **docker:** build client React workspace and serve single-page app via sirv ([ce70716](https://github.com/mctlhq/mctl-academy/commit/ce70716ec36a70ff1f1d4afc6cb957cfb6936af3))
* **docker:** copy client package manifests before npm ci ([b0de50a](https://github.com/mctlhq/mctl-academy/commit/b0de50a633d4d2caec7814c3eb1631898add177c))
* **docker:** copy client package manifests before npm ci --include=optional ([1075a6e](https://github.com/mctlhq/mctl-academy/commit/1075a6ec8b56f86bc8ff21bea7249f6d299a0af3))
* **docker:** correct build-content-bundle script path in Dockerfile ([5dded78](https://github.com/mctlhq/mctl-academy/commit/5dded78613e49c38f3d24aba570b27ac440f23e6))
* **docker:** correct script path in Dockerfile ([e76b87a](https://github.com/mctlhq/mctl-academy/commit/e76b87a93b5ed0adeca1fb9198384682931f775a))
* **docker:** install optional native build deps and add user-event to client devDeps ([8675183](https://github.com/mctlhq/mctl-academy/commit/8675183cb539603ab7c00a09bd02598622d71f47))
* **docker:** resolve native binding build error in Docker ([b9353cc](https://github.com/mctlhq/mctl-academy/commit/b9353ccdc4ec77800d24e9d9ec2fe7c240408d5d))
* **docker:** simplify builder stage to run client npm run build ([29e96f5](https://github.com/mctlhq/mctl-academy/commit/29e96f5be33ea6d3c41bbd6048251fa4df5342fb))
* **docker:** simplify client build stage ([2b4fe35](https://github.com/mctlhq/mctl-academy/commit/2b4fe3524392c521f61dcf0057fec298165fdfb6))
* **docker:** use npx vite build directly in Dockerfile ([3c88351](https://github.com/mctlhq/mctl-academy/commit/3c88351d1281f6dd5cd75c245313b188a1d787f5))
* **docker:** use npx vite build in Dockerfile ([577e34f](https://github.com/mctlhq/mctl-academy/commit/577e34f4b0b4ec560b3cb695460aa674d64b0a39))

## [0.1.2](https://github.com/mctlhq/mctl-academy/compare/0.1.1...0.1.2) (2026-08-07)


### Features

* **agents:** issue-19-feat-ui-implement-practice-mode-screen-w ([c112643](https://github.com/mctlhq/mctl-academy/commit/c112643dff6dc3aa131b141f23ea11327e48ff98))
* **client:** add practice mode screen with instant feedback ([e701f81](https://github.com/mctlhq/mctl-academy/commit/e701f813281110cb282a9e8c74cca5dd43067101))


### Bug Fixes

* add /usr/local/bin to runner job PATH so gh is found ([a7a502b](https://github.com/mctlhq/mctl-academy/commit/a7a502b23e8835de08d9b7fffbf3ab9971049e6c))
* address agy's P1 findings on its own review workflow ([c5a5903](https://github.com/mctlhq/mctl-academy/commit/c5a5903cb73f9d78e4dd92d24d2b05289a5bc75a))
* address second round of agy P1 findings (marker forgery, sandbox escape) ([5c80186](https://github.com/mctlhq/mctl-academy/commit/5c80186730dc0a3e39e00e6d11003374f2c132c4))
* **ci:** install root dependencies in client job for scripts/ imports ([c7fa097](https://github.com/mctlhq/mctl-academy/commit/c7fa097a97018be5b01f978ae7e8b96afec5a586))
* **client:** add yaml dependency for content bundle build ([754976b](https://github.com/mctlhq/mctl-academy/commit/754976bde8ea07ba3642e15a0be7f3c267645986))
* **scripts:** use fileURLToPath for cross-platform Windows path resolution ([f3b4805](https://github.com/mctlhq/mctl-academy/commit/f3b480517fe5c0a9397c1c3b6efc10fb3b6d5e25))
* **tests:** use fileURLToPath in build-content-bundle.test.mjs for Windows compatibility ([ada1829](https://github.com/mctlhq/mctl-academy/commit/ada1829214fa8f48f7079c4d8d5e1e43c3a49105))

## [0.1.1](https://github.com/mctlhq/mctl-academy/compare/0.1.0...0.1.1) (2026-08-06)


### Features

* add content schemas and a failing-closed content lint ([a528a2c](https://github.com/mctlhq/mctl-academy/commit/a528a2cda0c66afd4778901b42dd9dbf2d6cac4d))
* add first eight sources and twenty draft questions ([558a97f](https://github.com/mctlhq/mctl-academy/commit/558a97f2a0584fe0f516ef08487c418d7f680e47))
* content schemas and failing-closed content lint ([46d7a51](https://github.com/mctlhq/mctl-academy/commit/46d7a51ab04f952c6b30b6bc46674889df95ac5d))
* define the course outline and correct the source allowlist ([95cb330](https://github.com/mctlhq/mctl-academy/commit/95cb3304a9a5b1beba4d54a375c431c4952f6851))
* define the course outline and correct the source allowlist ([cffe9ff](https://github.com/mctlhq/mctl-academy/commit/cffe9ffaec82b1169071eb9bcd916fc2f2ebc283))
* first eight sources and twenty draft questions ([89e2613](https://github.com/mctlhq/mctl-academy/commit/89e26134dcddf5f9ca337bb6326a214c40d6fe99))
* generate a static course preview from content ([2e05d15](https://github.com/mctlhq/mctl-academy/commit/2e05d15a5f35df46e601dcdc653583112b5d2527))
* generate a static course preview from content ([#8](https://github.com/mctlhq/mctl-academy/issues/8)) ([7000055](https://github.com/mctlhq/mctl-academy/commit/7000055cd89ed95d0640e14c865e65b225cea613))
* verify citations against the private snapshot store ([0f7ef3b](https://github.com/mctlhq/mctl-academy/commit/0f7ef3b6049dbc868916f223c0bfa52f6daffbba))
* verify citations against the private snapshot store ([5112088](https://github.com/mctlhq/mctl-academy/commit/511208892780248f4256e7024ca304769e2db445))


### Bug Fixes

* close a fail-open gap in the store-unconfigured guard ([8a62907](https://github.com/mctlhq/mctl-academy/commit/8a62907b64777d4c34bcd3ffeacabf602281dd5d))
