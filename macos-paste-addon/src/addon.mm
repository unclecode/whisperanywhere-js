#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Security/Security.h>
#include <napi.h>

bool isSandboxed() {
    SecTaskRef task = SecTaskCreateFromSelf(NULL);
    CFTypeRef value = SecTaskCopyValueForEntitlement(task, CFSTR("com.apple.security.app-sandbox"), NULL);
    bool sandboxed = value != NULL;
    if (value != NULL) {
        CFRelease(value);
    }
    CFRelease(task);
    return sandboxed;
}

Napi::Value PasteText(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string text = info[0].As<Napi::String>().Utf8Value();
    NSString* nsText = [NSString stringWithUTF8String:text.c_str()];

    @autoreleasepool {
        NSLog(@"Attempting to paste text: %@", nsText);
        NSLog(@"Current process: %@", [[NSProcessInfo processInfo] processName]);
        NSLog(@"Current working directory: %@", [[NSFileManager defaultManager] currentDirectoryPath]);

        if (isSandboxed()) {
            NSLog(@"Application is sandboxed");
        } else {
            NSLog(@"Application is not sandboxed");
        }

        // Get the frontmost application
        NSRunningApplication* frontmostApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
        if (!frontmostApp) {
            NSLog(@"Could not get frontmost application");
            Napi::Error::New(env, "Could not get frontmost application").ThrowAsJavaScriptException();
            return env.Null();
        }

        NSLog(@"Frontmost application: %@", [frontmostApp localizedName]);

        // Activate the frontmost application
        [frontmostApp activateWithOptions:NSApplicationActivateIgnoringOtherApps];
        NSLog(@"Activated frontmost application");

        // Set the pasteboard content
        NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
        [pasteboard clearContents];
        BOOL success = [pasteboard setString:nsText forType:NSPasteboardTypeString];
        NSLog(@"Set pasteboard content: %@", success ? @"Success" : @"Failure");

        // Try multiple paste methods
        for (int i = 0; i < 3; i++) {
            NSLog(@"Paste attempt %d", i + 1);
            
            [NSThread sleepForTimeInterval:(i + 1) * 0.5]; // Increasing delay for each attempt

            // Method 1: AppleScript
            if (i == 0 || i == 1) {
                NSString *appleScriptString = [NSString stringWithFormat:@"tell application \"System Events\"\n"
                                               "    tell process \"%@\"\n"
                                               "        set frontmost to true\n"
                                               "        delay 0.5\n"
                                               "        keystroke \"v\" using command down\n"
                                               "    end tell\n"
                                               "end tell", [frontmostApp localizedName]];
                
                NSAppleScript *script = [[NSAppleScript alloc] initWithSource:appleScriptString];
                NSDictionary *error = nil;
                [script executeAndReturnError:&error];
                if (error) {
                    NSLog(@"AppleScript error on attempt %d: %@", i + 1, error);
                } else {
                    NSLog(@"AppleScript paste executed successfully on attempt %d", i + 1);
                    return env.Null();
                }
            }

            // Method 2: CGEventCreate
            else {
                CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
                CGEventRef keyDown = CGEventCreateKeyboardEvent(source, (CGKeyCode)9, true);
                CGEventRef keyUp = CGEventCreateKeyboardEvent(source, (CGKeyCode)9, false);

                CGEventSetFlags(keyDown, kCGEventFlagMaskCommand);
                CGEventSetFlags(keyUp, kCGEventFlagMaskCommand);

                CGEventPost(kCGHIDEventTap, keyDown);
                CGEventPost(kCGHIDEventTap, keyUp);

                CFRelease(keyUp);
                CFRelease(keyDown);
                CFRelease(source);

                NSLog(@"CGEventCreate paste attempted");
                return env.Null();
            }
        }

        // If we've reached this point, all paste attempts have failed
        NSLog(@"All paste attempts failed");
        Napi::Error::New(env, "Failed to paste after multiple attempts").ThrowAsJavaScriptException();
    }

    return env.Null();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "pasteText"), Napi::Function::New(env, PasteText));
    return exports;
}

NODE_API_MODULE(macos_paste_addon, Init)