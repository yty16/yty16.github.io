-keep class io.github.yty16.toolbox.watch.** { *; }
-keepclassmembers class * extends android.app.Activity {
    public void *(android.os.Bundle);
}
-dontwarn com.google.**
