#define AppName "IDELite"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef BuildDir
  #define BuildDir "..\..\dist\windows"
#endif

[Setup]
AppId={{E0B9F928-F649-433F-B96D-6B4666FE4B1E}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=pythonIsFast
AppPublisherURL=https://github.com/pythonIsFast/IDELite
DefaultDirName={localappdata}\Programs\IDELite
DefaultGroupName=IDELite
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=.
OutputBaseFilename=IDELite-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\IDELite.exe

[Files]
Source: "{#BuildDir}\IDELite\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\IDELite"; Filename: "{app}\IDELite.exe"
Name: "{autodesktop}\IDELite"; Filename: "{app}\IDELite.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\IDELite.exe"; Description: "Launch IDELite"; Flags: nowait postinstall skipifsilent
