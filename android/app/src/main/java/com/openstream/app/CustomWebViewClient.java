package com.openstream.app;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;

public class CustomWebViewClient extends BridgeWebViewClient {
    // Standard blocklist matching major popunder/ad-serving domains loaded by iframe embeds
    private static final String[] BLOCKED_AD_DOMAINS = {
        "adsterra.com", "adnxs.com", "adsco.re", "onclickads.net", "exoclick.com", 
        "popads.net", "popcash.net", "yandex.ru/clck", "doubleclick.net", "google-analytics.com",
        "googlesyndication.com", "adservice.google.com", "histats.com", "juicyads.com",
        "onclkds.com", "propellerads.com", "exdynsrv.com", "clksite.com", "bullclip.com",
        "vidoza.net/ad", "highrevenuegate.com", "profitablegatecpm.com", "toprevenuegate.com",
        "onclickperformance.com", "adsterramod.com", "onclickprofit.com"
    };

    // Only allow legitimate external links clicked from the app to open
    private static final String[] ALLOWED_EXTERNAL_DOMAINS = {
        "github.com",
        "ublockdns.com",
        "chromewebstore.google.com",
        "mozilla.org",
        "microsoft.com",
        "adguard.com",
        "themoviedb.org",
        "tmdb.org",
        "stripe.com"
    };

    public CustomWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String url = request.getUrl().toString().toLowerCase();

        // If request URL contains any of the blocked ad networks, return an empty 200 response
        for (String pattern : BLOCKED_AD_DOMAINS) {
            if (url.contains(pattern)) {
                return new WebResourceResponse(
                    "text/plain", 
                    "UTF-8", 
                    new ByteArrayInputStream(new byte[0])
                );
            }
        }

        // Delegate other requests to Capacitor's Bridge to maintain core bridge functions
        return super.shouldInterceptRequest(view, request);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        String url = request.getUrl().toString().toLowerCase();
        String host = request.getUrl().getHost();

        // 1. Specifically block known ad domains first (for both main frame and iframes)
        for (String pattern : BLOCKED_AD_DOMAINS) {
            if (url.contains(pattern)) {
                return true; // Block the redirect
            }
        }

        // 2. If it's an iframe navigating (like our video players), allow it to load naturally inside the WebView.
        if (!request.isForMainFrame()) {
            return false; 
        }

        // 3. Main frame navigation: If the URL is an internal localhost/capacitor app URL, let Capacitor handle it
        if (host == null || host.equals("localhost") || url.startsWith("capacitor://") || url.startsWith("file://")) {
            return super.shouldOverrideUrlLoading(view, request);
        }

        // 4. Main frame navigation: Check if the external domain is in our whitelist
        if (host != null) {
            for (String allowed : ALLOWED_EXTERNAL_DOMAINS) {
                if (host.contains(allowed)) {
                    return super.shouldOverrideUrlLoading(view, request);
                }
            }
        }

        // 5. If it's an external domain not in our whitelist (like an arbitrary popunder redirect hijacking the app), BLOCK IT
        return true; 
    }
}
