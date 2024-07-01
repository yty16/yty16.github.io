const UseDarkList = 1;
const UseWhiteList = 1;
var isallow = 1;
const IPDarkList = [];
const IPWhiteList = ["219.231.129.121","219.231.129.60","219.231.129.61","112.224.162.136","112.231.189.*"];
var allowedDomains = [
    "https://yty16.github.io/",
    "https://yty16.pages.dev/"
];

var referrer = window.location.href;
if (Number(isallow) === 0 && !allowedDomains.some(function(domain) {
        return referrer.includes(domain);
    })) {
    alert("未授权访问");
    window.location.href = "about:blank";
}

try {
    if (!UseDarkList && !UseWhiteList) {
        throw new Error('访问控制未启用');
    }
} catch (e) {
    console.warn(e.message); // Log the error or handle it accordingly
}
const patternToRegExp = pattern => new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
const getIP = () => Promise.any([
    fetch('https://www.cip.cc/').then(r => r.text()).then(t => t.match(/(\d+\.){3}\d+/)[0]),
    fetch('https://ip.3322.net/').then(r => r.text()),
    fetch('https://myip.ipip.net').then(r => r.text()).then(t => t.match(/\d+\.\d+\.\d+\.\d+/)[0])
]);
(async () => {
    try {
        const userIP = (await getIP()).trim();
        if (UseWhiteList && IPWhiteList.some(p => patternToRegExp(p).test(userIP))) {
            return;
        }
        if (UseDarkList && IPDarkList.some(p => patternToRegExp(p).test(userIP))) {
            alert("该IP已被封禁");
            window.location.href = "about:blank";
        }
    } catch (e) {
        console.warn('IP检测失败:', e);
    }
})();
