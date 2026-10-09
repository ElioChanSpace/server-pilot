# macOS 构建环境（Xcode 许可证未同意时使用）
#
# 症状：cargo build/test 报 `linking with cc failed: exit status: 69`，
#       提示 "You have not agreed to the Xcode license agreements"。
#
# 首选修复（一次性，需要管理员密码，在终端手动执行）：
#   sudo xcodebuild -license accept
#
# 若无法使用 sudo，可在构建前加载本脚本，改用 Command Line Tools 工具链：
#   source scripts/macos-build-env.sh
#   cargo build / cargo test / npm run tauri build
#
# 用完无需取消设置；新开的终端会话自动恢复默认。

_CLT_SDK="/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk"
_CLT_BIN="/Library/Developer/CommandLineTools/usr/bin"

if [ ! -d "$_CLT_SDK" ]; then
  echo "错误: 未找到 Command Line Tools SDK ($_CLT_SDK)" >&2
  echo "请先执行: xcode-select --install （或接受 Xcode 许可证: sudo xcodebuild -license accept）" >&2
  return 1 2>/dev/null || exit 1
fi

export PATH="$_CLT_BIN:$PATH"
export SDKROOT="$_CLT_SDK"
export CC="$_CLT_BIN/clang"
export CXX="$_CLT_BIN/clang++"
export CFLAGS="-isysroot $_CLT_SDK"
export CXXFLAGS="-isysroot $_CLT_SDK"
export OBJCFLAGS="-isysroot $_CLT_SDK"
export CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER="$_CLT_BIN/clang"
export RUSTFLAGS="-C link-arg=-isysroot -C link-arg=$_CLT_SDK"

echo "已启用 CommandLineTools 构建环境 (SDK: $_CLT_SDK)"
