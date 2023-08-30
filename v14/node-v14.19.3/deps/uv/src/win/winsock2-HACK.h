#include "winsock2.h"
#include "ws2tcpip.h"
#include <stdio.h>
#include <stdlib.h>



/* This is a custom implementation of GetHostNameW function which is 
implemented according to the description provided by Microsoft. 
Since the official GetHostNameW function is available starting from Windows 8, 
this implementation enables support for Windows 7. 
https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-gethostnamew */
int WSAAPI GetHostNameW(PWSTR name, int namelen);
