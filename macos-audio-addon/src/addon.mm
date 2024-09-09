#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreAudio/CoreAudio.h>
#include <napi.h>
#include <vector>
#include <algorithm>
#include <atomic>

AVAudioEngine *audioEngine = nil;
AVAudioInputNode *inputNode = nil;
AVAudioFormat *recordingFormat = nil;
AVAudioConverter *audioConverter = nil;
NSMutableData *audioBuffer = nil;
std::atomic<bool> isRecording(false);
const Float64 TARGET_SAMPLE_RATE = 16000.0;

void LogToConsole(const char* message) {
    printf("%s\n", message);
    fflush(stdout);
}

void CleanupResources() {
    [audioEngine stop];
    [inputNode removeTapOnBus:0];
    audioEngine = nil;
    inputNode = nil;
    recordingFormat = nil;
    audioConverter = nil;
    audioBuffer = nil;
    isRecording.store(false);
}

NSString* GetDefaultInputDeviceName() {
    AudioDeviceID deviceID = 0;
    UInt32 propertySize = sizeof(AudioDeviceID);
    AudioObjectPropertyAddress propertyAddress = {
        kAudioHardwarePropertyDefaultInputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMaster
    };
    
    OSStatus status = AudioObjectGetPropertyData(kAudioObjectSystemObject, &propertyAddress, 0, NULL, &propertySize, &deviceID);
    if (status != noErr) {
        return @"Unknown Device";
    }
    
    CFStringRef deviceName = NULL;
    propertySize = sizeof(CFStringRef);
    propertyAddress.mSelector = kAudioDevicePropertyDeviceNameCFString;
    propertyAddress.mScope = kAudioObjectPropertyScopeGlobal;
    status = AudioObjectGetPropertyData(deviceID, &propertyAddress, 0, NULL, &propertySize, &deviceName);
    
    if (status != noErr || deviceName == NULL) {
        return @"Unknown Device";
    }
    
    NSString *result = (NSString *)CFBridgingRelease(deviceName);
    return result;
}

Napi::Boolean StartRecording(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
        if (audioEngine) {
            LogToConsole("Recording is already in progress");
            return Napi::Boolean::New(env, false);
        }

        LogToConsole("Initializing audio engine");
        audioEngine = [[AVAudioEngine alloc] init];
        inputNode = audioEngine.inputNode;
        if (!inputNode) {
            LogToConsole("Failed to get input node");
            throw std::runtime_error("Failed to get input node");
        }

        AVAudioFormat *inputFormat = [inputNode inputFormatForBus:0];
        recordingFormat = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32
                                                           sampleRate:TARGET_SAMPLE_RATE
                                                             channels:1
                                                          interleaved:NO];

        NSString *deviceInfo = [NSString stringWithFormat:@"Recording device: %@, Input Sample Rate: %.0f Hz, Target Sample Rate: %.0f Hz",
                                GetDefaultInputDeviceName(), inputFormat.sampleRate, recordingFormat.sampleRate];
        LogToConsole([deviceInfo UTF8String]);

        audioBuffer = [NSMutableData new];

        LogToConsole("Installing tap on input node");
        [inputNode installTapOnBus:0 bufferSize:4096 format:inputFormat block:^(AVAudioPCMBuffer * _Nonnull buffer, AVAudioTime * _Nonnull when) {
            if (!isRecording.load()) {
                return;
            }
            
            // Simple downsampling by skipping samples
            float *inputData = buffer.floatChannelData[0];
            int inputSampleRate = inputFormat.sampleRate;
            int outputSampleRate = TARGET_SAMPLE_RATE;
            int skipFactor = inputSampleRate / outputSampleRate;
            
            NSMutableData *processedData = [NSMutableData dataWithCapacity:buffer.frameLength / skipFactor * sizeof(float)];
            
            // NSMutableData *downsampledData = [NSMutableData dataWithCapacity:buffer.frameLength / skipFactor * sizeof(float)];
            
            // for (int i = 0; i < buffer.frameLength; i += skipFactor) {
            //     float sample = inputData[i];
            //     [downsampledData appendBytes:&sample length:sizeof(float)];
            // }

            // Amplification factor (adjust as needed)
            float amplificationFactor = 2.0f;
            
            for (int i = 0; i < buffer.frameLength; i += skipFactor) {
                float sample = inputData[i];
                
                // Amplify the sample
                sample *= amplificationFactor;
                
                // Clip the sample to avoid distortion
                if (sample > 1.0f) sample = 1.0f;
                if (sample < -1.0f) sample = -1.0f;
                
                [processedData appendBytes:&sample length:sizeof(float)];
            }
            
            @synchronized (audioBuffer) {
                [audioBuffer appendData:processedData];
            }
            
            LogToConsole(([NSString stringWithFormat:@"Total buffer size: %lu bytes", (unsigned long)audioBuffer.length].UTF8String));
        }];

        NSError *error = nil;
        LogToConsole("Starting audio engine");
        if (![audioEngine startAndReturnError:&error]) {
            NSString *errorMsg = [NSString stringWithFormat:@"Failed to start audio engine: %@", [error localizedDescription]];
            LogToConsole([errorMsg UTF8String]);
            CleanupResources();
            throw std::runtime_error([errorMsg UTF8String]);
        }

        isRecording.store(true);
        LogToConsole("Audio engine started successfully");
        return Napi::Boolean::New(env, true);
    } catch (const std::exception& e) {
        LogToConsole(e.what());
        CleanupResources();
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }
}

Napi::Object StopRecording(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    try {
        if (!audioEngine || !audioBuffer) {
            LogToConsole("No recording in progress or audio buffer is null");
            throw std::runtime_error("No recording in progress or audio buffer is null");
        }

        LogToConsole("Stopping audio engine");
        isRecording.store(false);
        [audioEngine stop];
        [inputNode removeTapOnBus:0];

        NSUInteger bufferLength;
        @synchronized (audioBuffer) {
            bufferLength = audioBuffer.length;
        }
        LogToConsole(([NSString stringWithFormat:@"Final buffer size: %lu bytes", (unsigned long)bufferLength].UTF8String));

        if (bufferLength == 0) {
            CleanupResources();
            throw std::runtime_error("Audio buffer is empty");
        }

        // Create WAV header
        NSMutableData *wavHeader = [NSMutableData dataWithCapacity:44];
        uint32_t dataSize = (uint32_t)bufferLength;
        uint32_t fileSize = dataSize + 36;
        uint16_t channels = recordingFormat.channelCount;
        uint32_t sampleRate = recordingFormat.sampleRate;
        uint32_t byteRate = sampleRate * channels * 4; // 4 bytes per sample (32-bit float)
        uint16_t blockAlign = channels * 4;

        // RIFF chunk descriptor
        [wavHeader appendBytes:"RIFF" length:4];
        [wavHeader appendBytes:&fileSize length:4];
        [wavHeader appendBytes:"WAVE" length:4];

        // "fmt " sub-chunk
        [wavHeader appendBytes:"fmt " length:4];
        uint32_t fmtSize = 16;
        [wavHeader appendBytes:&fmtSize length:4];
        uint16_t audioFormat = 3; // IEEE float
        [wavHeader appendBytes:&audioFormat length:2];
        [wavHeader appendBytes:&channels length:2];
        [wavHeader appendBytes:&sampleRate length:4];
        [wavHeader appendBytes:&byteRate length:4];
        [wavHeader appendBytes:&blockAlign length:2];
        uint16_t bitsPerSample = 32;
        [wavHeader appendBytes:&bitsPerSample length:2];

        // "data" sub-chunk
        [wavHeader appendBytes:"data" length:4];
        [wavHeader appendBytes:&dataSize length:4];

        // Combine WAV header and audio data
        NSMutableData *wavData = [NSMutableData dataWithData:wavHeader];
        [wavData appendData:audioBuffer];

        // Create an object to return the WAV data
        LogToConsole("Creating return object");
        Napi::Object result = Napi::Object::New(env);
        result.Set("buffer", Napi::Buffer<char>::Copy(env, (char*)wavData.bytes, wavData.length));
        result.Set("sampleRate", Napi::Number::New(env, recordingFormat.sampleRate));
        result.Set("channels", Napi::Number::New(env, recordingFormat.channelCount));
        result.Set("bitDepth", Napi::Number::New(env, 32));
        result.Set("format", Napi::String::New(env, "wav"));

        // Clean up
        LogToConsole("Cleaning up audio engine resources");
        CleanupResources();

        LogToConsole("StopRecording completed successfully");
        return result;
    } catch (const std::exception& e) {
        LogToConsole(e.what());
        CleanupResources();
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return Napi::Object::New(env);
    }
}


Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("startRecording", Napi::Function::New(env, StartRecording));
    exports.Set("stopRecording", Napi::Function::New(env, StopRecording));
    return exports;
}

NODE_API_MODULE(macos_audio_addon, Init)