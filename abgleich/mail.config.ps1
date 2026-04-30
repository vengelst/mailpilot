@{
    remoteName = 'origin'
    branch = 'main'
    repoUrl = 'https://github.com/vengelst/mailpilot.git'
    serverHost = 'mailpilot.vivahome.de'
    serverUser = 'root'
    serverPath = '/opt/mailpilot'
    nginxConfigLocalPath = 'deploy/nginx/mailpilot.vivahome.de.conf'
    nginxConfigName = 'mailpilot.vivahome.de.conf'
    nginxSitesAvailablePath = '/etc/nginx/sites-available'
    nginxSitesEnabledPath = '/etc/nginx/sites-enabled'
    forceServerReset = $true
}
