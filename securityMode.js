window.addEventListener('load', function () {
    const securityCheckbox = document.getElementById('security-mode');
    let securityEnabled = false;
    let originalContent = document.body.innerHTML;
    let originalTitle = document.title; // 保存原始标题
    let pressTimer; // 长按计时器

    // 安全模式切换
    securityCheckbox.addEventListener('change', function () {
        securityEnabled = securityCheckbox.checked;
        if (securityEnabled) {
            originalContent = document.body.innerHTML;
            originalTitle = document.title;
        } else {
            restoreContent();
        }
    });

    // 标签页切换检测
    document.addEventListener('visibilitychange', function () {
        if (securityEnabled && document.visibilityState === 'hidden') {
            document.title = "THIS SITE IS BLOCKED!"; // 修改标题
            document.body.style.cssText = "text-align:center; background:#36648B; font-family:arial; color:#DEDEDE;"; // 直接设置body样式
            document.body.innerHTML = '<div style="font-size:90px;margin-top:300px;">该网页已被阻止！</div>';
        }
    });

    // 长按恢复功能（桌面+移动端兼容）
    document.addEventListener('mousedown', startPressTimer);
    document.addEventListener('touchstart', startPressTimer);
    document.addEventListener('mouseup', cancelPressTimer);
    document.addEventListener('touchend', cancelPressTimer);
    document.addEventListener('mouseleave', cancelPressTimer);

    function startPressTimer() {
        if (securityEnabled) {
            pressTimer = setTimeout(restoreContent, 1000); // 1秒长按
        }
    }

    function cancelPressTimer() {
        clearTimeout(pressTimer);
    }

    function restoreContent() {
        document.body.innerHTML = originalContent;
        document.title = originalTitle; // 还原标题
        document.body.style.cssText = ""; // 清除强制样式
    }
});
