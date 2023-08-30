#include "winsock2-HACK.h"



/* This is a custom implementation of GetHostNameW function which is 
implemented according to the description provided by Microsoft. 
Since the official GetHostNameW function is available starting from Windows 8, 
this implementation enables support for Windows 7. 
https://learn.microsoft.com/en-us/windows/win32/api/winsock2/nf-winsock2-gethostnamew */
int WSAAPI GetHostNameW(PWSTR name, int namelen) {
    /* Check whether input parameters are valid. */
    if (name == NULL || namelen <= 0) {
        return SOCKET_ERROR;
    }
    
    /* Call gethostname function to retrieve the standard host name for the local computer 
    as a null-terminated ASCII string. 

    In case namelen parameter is smaller than the actual length of the host name, 
    gethostname truncates the host name to fit within the provided length. When 
    MultiByteToWideChar is subsequently called, it expects the source buffer to be 
    null-terminated. If the host name is truncated, the null-terminator may be lost, 
    which may have severe consequences. 
    
    To address this, I handle the variable length manually. */

    char host_name[256]; // host name must be 256 bytes or less
    HRESULT hr = gethostname(host_name, sizeof(host_name));
    if (hr != 0) {
        return SOCKET_ERROR;
    }
    /* Get the actual host name length. */
    size_t host_name_length = 0;
    for (size_t i = 0; host_name[i]; i++) {
        host_name_length++;
    }
    /* Check if the provided buffer size is sufficient. */
    if (host_name_length >= namelen) {
        return SOCKET_ERROR;
    }
    /* Copy the ASCII host name to the buffer and null-terminate. */
    strcpy_s(name, namelen, host_name);
    /* Convert the ASCII string to the Unicode string and write it 
    to the buffer specified in the function inputs. */
    int result = MultiByteToWideChar(CP_UTF8, 0, host_name, -1, name, namelen);
    if (result == 0) {
        return SOCKET_ERROR;
    }
    /* Return success. */
    return 0;
}
