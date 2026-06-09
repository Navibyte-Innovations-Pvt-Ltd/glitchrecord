cask "glitchgrab" do
  arch arm: "arm64", intel: "x64"

  version "1.1.14"
  sha256 arm:   "e669ab7c8bdd4596211937183ee2374545da5482702cab0dfe477c1466422b0f",
         intel: "85f5183219de0b656400625797ff9299893bd8fbda8455b0f745878b2c729526"

  url "https://github.com/webadderallorg/GlitchGrab/releases/download/v#{version}/GlitchGrab-#{arch}.dmg"
  name "GlitchGrab"
  desc "Creator-focused screen recorder with auto-zoom, cursor effects, and more"
  homepage "https://github.com/webadderallorg/GlitchGrab"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "GlitchGrab.app"

  zap trash: [
    "~/Library/Application Support/GlitchGrab",
    "~/Library/Preferences/dev.glitchgrab.app.plist",
    "~/Library/Saved Application State/dev.glitchgrab.app.savedState",
  ]
end
