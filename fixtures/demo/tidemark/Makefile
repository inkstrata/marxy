.PHONY: test release

test:
	cargo test

release:
	cargo build --release
	./scripts/sign.sh target/release/tidemark
