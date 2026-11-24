package gt.edu.fernando.facerecognition;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FaceLivenessPlugin.class);
        super.onCreate(savedInstanceState);
        new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(false);
    }
}
