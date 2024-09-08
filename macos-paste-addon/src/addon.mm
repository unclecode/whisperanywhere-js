#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#include <napi.h>

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

        // Increased delay to ensure the application is active
        [NSThread sleepForTimeInterval:0.5];

        // Set the pasteboard content
        NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
        [pasteboard clearContents];
        BOOL success = [pasteboard setString:nsText forType:NSPasteboardTypeString];
        NSLog(@"Set pasteboard content: %@", success ? @"Success" : @"Failure");

        // Use AppleScript to paste
        NSString *appleScriptString = @"tell application \"System Events\"\n"
                                      "    keystroke \"v\" using command down\n"
                                      "end tell";
        NSAppleScript *script = [[NSAppleScript alloc] initWithSource:appleScriptString];
        NSDictionary *error = nil;
        NSAppleEventDescriptor *result = [script executeAndReturnError:&error];
        
        if (error) {
            NSLog(@"AppleScript error: %@", error);
        } else {
            NSLog(@"AppleScript paste executed successfully");
        }

        NSLog(@"Paste operation completed");
    }

    return env.Null();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "pasteText"), Napi::Function::New(env, PasteText));
    return exports;
}

NODE_API_MODULE(macos_paste_addon, Init)