Pod::Spec.new do |s|
  s.name           = 'WafraIncomingFile'
  s.version        = '1.0.0'
  s.summary        = 'Copies a statement opened in Wafra from Files or iCloud Drive into its Inbox'
  s.description    = 'Security-scoped, coordinated, size-bounded copy of a handed-over statement file.'
  s.author         = 'Wafra'
  s.homepage       = 'https://wafra.app'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: 'https://github.com/wafra-app/wafra' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
  s.exclude_files = 'Tests/**/*'
end
