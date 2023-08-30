## Building

1. Install [Visual Studio IDE](https://visualstudio.microsoft.com/), release 2019 or 2022. The edition year is important since Node.js 16 refuses to build on different Visual Studio versions. Visual Studio is needed to perform a build.
2. Use Visual Studio Installer to install English language pack and the following development tools from the "Desktop development with C++" workload:
* C++ build tools MSVC v140 for Visual Studio 2015
* C++ build tools MSVC v142 for Visual Studio 2019 or C++ build tools MSVC v143 for Visual Studio 2022 depending on which Visual Studio edition year is installed
* Windows 10 SDK (10.0.19041.0)
* Just-In-Time debugger
* C++ profiling tools
* C++ CMake tools for Windows
* C++ ATL library for the latest v142 build tools (x86 and x64)
* C++ AddressSanitizer
3. Install [Python 3.8](https://www.python.org/downloads/release/python-3810/).
4. Install [NetWide Assembler 2.15.05](https://www.nasm.us/pub/nasm/releasebuilds/2.15.05/) for OpenSSL assembler modules. If not installed in the default location, it needs to be manually added to `PATH`.
5. Basic Unix tools are required for some tests. Install [Git for Windows](https://git-scm.com/download/win) which includes Git Bash and tools which can be included in the global `PATH`.
6. Install [WiX Toolset v3.11](https://wixtoolset.org/docs/wix3/) and 
[Wix Toolset Visual Studio 2019 Extension](https://marketplace.visualstudio.com/items?itemName=WixToolset.WixToolsetVisualStudio2019Extension) or 
[Wix Toolset Visual Studio 2022 Extension](https://marketplace.visualstudio.com/items?itemName=WixToolset.WixToolsetVisualStudio2022Extension) depending on which Visual Studio edition year is installed.
7. Download the source code from this repository as ZIP. I do not recommend using Git. In case some issue happens, this repository may be force pushed. Unpack to a path that does not contain spaces.
8. In the terminal, go to the folder with the Node.js source code and run ```vcbuild.bat release x64 msi && vcbuild.bat release x86 msi```. Although there is a Visual Studio solution in the source code, do not try to build Node.js installers using Visual Studio, otherwise, you get an error saying that ```wcautil.h``` is missing. 
9. After compilation, Node.js installers are placed in the same directory as ```vcbuild.bat```, and the embeddable packages are put in the ```Release``` folder. Enjoy problem solving with Node.js!
