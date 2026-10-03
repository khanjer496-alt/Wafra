Pod::Spec.new do |s|
  s.name           = 'WafraOnDeviceAI'
  s.version        = '1.0.0'
  s.summary        = 'Advisory on-device language model bridge for Wafra'
  s.description    = 'Apple Foundation Models on iOS 26+, guarded so iOS 15.1 builds still launch.'
  s.author         = 'Wafra'
  s.homepage       = 'https://wafra.app'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: 'https://github.com/wafra-app/wafra' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # The app deploys to iOS 15.1 and FoundationModels only exists on iOS 26+.
  # Every use is behind `#if canImport(FoundationModels)` and
  # `@available(iOS 26.0, *)`; weak linking keeps dyld from refusing to launch
  # the app on an OS without the framework.
  s.weak_frameworks = 'FoundationModels'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
  s.exclude_files = 'Tests/**/*'
end
