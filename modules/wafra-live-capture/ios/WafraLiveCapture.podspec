Pod::Spec.new do |s|
  s.name           = 'WafraLiveCapture'
  s.version        = '1.0.0'
  s.summary        = 'Protected on-device staging for Wafra live bank alerts'
  s.description    = 'Bridges an Apple Shortcut into Wafra without uploading raw Message text.'
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
  s.resource_bundles = {
    'WafraLiveCaptureResources' => ['Resources/**/*']
  }
end
