Pod::Spec.new do |s|
  s.name           = 'WafraMessageHistory'
  s.version        = '1.0.0'
  s.summary        = 'Local protected staging for Wafra historical Messages imports'
  s.description    = 'Bridges an iOS 26 Shortcut into Wafra without uploading raw message text.'
  s.author         = 'Wafra'
  s.homepage       = 'https://wafra.app'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: 'https://github.com/wafra-app/wafra' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
