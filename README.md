<img src="./node.js.png" alt="Node.js for Windows 7"/>

# Node.js 14+ for Windows 7

This repository contains installers of Node.js 14 and newer versions for Windows 7 and the source code of the Node.js runtime environment which is adapted for Windows 7 with the instructions on how to build it.

## Introduction

Node.js is a popular back-end JavaScript runtime environment which executes JavaScript code outside a web browser. Node.js has been continuously evolving since its inception. However, one significant change that recently occurred in Node.js was the drop of support for Windows 7. After version 13.6, [Node community stopped providing Windows 7 compatibility](https://github.com/nodejs/node/pull/31954) right in the middle of the development phase even without leading Node.js to its logical conclusion for this operating system in the form of the v14 LTS release.

## Theoretical background

Since version 14, Node.js uses ```GetHostNameW``` function from Windows Sockets API to retrieve the host name for the local computer in the Unicode string. Since ```GetHostNameW``` is available starting from Windows 8, Node.js complains on Windows 7 that it cannot find the entry point in ```GetHostNameW``` in the dynamic link library ```WS2_32.dll```.

The solution to this problem is the following: instead of asking for the function from Windows 7, we can directly provide ```GetHostNameW``` to the runtime environment while building it. I re-implement ```GetHostNameW``` function such that the conversion from the ASCII string into the Unicode string is done manually and include the custom implementation in Node.js in such a way that it comes on top of the original ```winsock2.h``` library.

## Building

Building instructions for different versions of Node.js are different. Each folder with each Node.js version has its building instructions.

## Where compatibility problems may arise

**The core Node.js interpreters and the standard Node.js libraries run correctly on Windows 7.** Nothing is cut or modified in Node.js itself, and the interpreters in these installers read the code in the same exact way as the interpreters in the official installers. However, in the future, you may experience compatibility issues with ```npm``` packages. The reason is that developers of these packages may drop support for Windows 7 considering that officially Node.js 14 and newer versions are not intended for this operating system. I cannot provide any help with such kind of trouble because I have no control over thousands of Node.js software packages. In this case, I recommend contacting the developer of the specific package which causes the compatibility issue.

## Why only even versions are present

This is the peculiarity of the release schedule of Node.js. According to [the release plan by Node.js Release Working Group](https://github.com/nodejs/release#release-schedule), only even-numbered major versions have been determined to be appropriate and stable for the release line. Even-numbered versions transition to long-term support and are actively maintained. Odd versions are not published here because they are not promoted to long-term support, not maintained and not recommended for most users.

## Do you plan to publish Node.js 20 "Iron"?

Yes, I do! I will start backporting Node.js 20 "Iron" to Windows 7 right after its first 20th release is published.

### See also: [Python 3.9+ for Windows Vista and Windows 7](https://github.com/vladimir-andreevich/cpython-windows-vista-and-7)
