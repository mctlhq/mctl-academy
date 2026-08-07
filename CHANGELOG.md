# Changelog

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
