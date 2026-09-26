Pod::Spec.new do |s|
  s.name           = 'WafraWidgets'
  s.version        = '1.0.0'
  s.summary        = 'Hands the Wafra widget snapshot to WidgetKit'
  s.description    = 'Writes the privacy-reduced widget summary to the shared App Group and reloads widget timelines. Never reads the ledger.'
  s.author         = 'Wafra'
  s.homepage       = 'https://wafra.app'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: 'https://github.com/wafra-app/wafra' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.weak_frameworks = 'WidgetKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
