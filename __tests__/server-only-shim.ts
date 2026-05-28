// Stand-in for the `server-only` package under Vitest. The real module
// throws on import (it relies on a bundler plugin to be stripped in server
// builds and to fail loudly in client bundles); under Node it'd just blow
// up the test. Vitest's `resolve.alias` swaps the import to this empty
// module so server-only source files load like any other.
export {};
