var cs5490 = null;
// comment below line for WebMatrix testing
var cs5490 = require("CS5490");

var HardwareVersion = 0;
var samples = 500;   // number of instantaneous voltage and current samples to collect for each measurement
var bytesPerSample = 10;
var OutputPins;
var sampleBuffer = new Buffer(samples * bytesPerSample);
var _DeviceOpen = false;

var Registers = {
    Config0: [0, 0],
    Config1: [0, 1],
    Mask: [0, 3],
    PhaseCompControl: [0, 5],
    SerialControl: [0, 7],
    Status0: [0, 23],
    Status1: [0, 24],
    Status2: [0, 25],
    PeakVoltge: [0, 36],
    PeakCurrent: [0, 37],
    PSDC: [0, 48],
    ZXNum: [0, 55],
    Config2: [16, 0],
    RegisterChecksum: [16, 1],
    InstCurrent: [16, 2],
    InstVoltage: [16, 3],
    InstPower: [16, 4],
    ActivePower: [16, 5],
    RmsCurrent: [16, 6],
    RmsVoltage: [16, 7],
    ReactivePower: [16, 14],
    InstReactivePower: [16, 15],
    ApparentPower: [16, 20],
    PowerFactor: [16, 21],
    Temperature: [16, 27],
    TotalActivePower: [16, 29],
    TotalApparentPower: [16, 30],
    TotalReactivePower: [16, 31],
    CurrentDCOffset: [16, 32],
    CurrentGain: [16, 33],
    VoltageDCOffset: [16, 34],
    VoltageGain: [16, 35],
    InstPowerOffset: [16, 36],
    CurrentACOffset: [16, 37],
    Epsilon: [16, 49],
    SampleCount: [16, 51],
    TemperatureGain: [16, 54],
    TemperatureOffset: [16, 55],
    FilterSettlingTime: [16, 57],
    NoLoadThreshold: [16, 58],
    SystemGain: [16, 60],
    SystemTime: [16, 61],
    VoltageSagDuration: [17, 0],
    VoltageSagLevel: [17, 1],
    OverCurrentDuration: [17, 4],
    OverCurrentLevel: [17, 5],
    CurrentChannelZeroCrossThrehold: [18, 24],
    PulseRate: [18, 28],
    RogowskiCoilIntgratorGain: [18, 43],
    VoltageSwellDuration: [18, 46],
    VoltageSwellLevel: [18, 47],
    VoltageChannelZeroCrossThrehold: [18, 58],
    CycleCount: [18, 62],
    Scale: [18, 63]
};

var sleep = function (delayMs) {
    var s = new Date().getTime();
    while ((new Date().getTime() - s) < delayMs) {
        //do nothing
        //console.log('sleeping');
    }
}

var write = function (register, val, desc) {
    if (_DeviceOpen) {
        cs5490.WriteRegister(register[0], register[1], val)
        if (desc != null)
            console.log('write: [' + register[0] + ', ' + register[1] + '] ' + desc + ' -> ' + val.toString(16));
    }
}

var read = function (register, desc) {
    if (_DeviceOpen) {
        var result = cs5490.ReadRegister(register[0], register[1]);
        if (desc != null)
            console.log('read: [' + register[0] + ', ' + register[1] + '] ' + desc + ' -> ' + result.toString(16));

        return result;
    } else {
        return null;
    }

}

var convertInt = function(n, binPt, neg)
{
  var power = binPt;
  var result = 0;
  for (i=0; i < 24; i++)
  {
    if (n & (1 << (23-i)))
    {
      if (neg && i == 0)
          result += -Math.pow(2, power);
      else
          result += Math.pow(2, power);
    }
    power--;
  }

  return result;
}

var convert = function (buffer, binPt, neg) {

    var power = binPt;
    var result = 0;
    for (var i = 0; i < 3; i++) {
        var byte = buffer[i];
        for (var j = 7; j >= 0; j--) {
            if (byte & (1 << j)) {

                var x;

                if (neg && i == 0 && j == 7)
                    x = -Math.pow(2, power);
                else
                    x = Math.pow(2, power);

                result += x;
            }
            power--;
        }
    }

    return result;
}

var ResetIfNeeded = function () {

    var config = read(Registers.Config2);
    var status = read(Registers.Status0);

    // Check status of:
    //   POR, IOR, VOR, IOC, IC
    //   High-pass filters enabled
    if (status & 0x5508) {
        console.log('Resetting due to incorrect status: ' + status.toString(16));
        console.error('Resetting due to incorrect status: ' + status.toString(16));
        Reset();
    }
    else if (!(config & 0xA)) {
        console.log('Resetting due to incorrect Config: ' + config.toString(16));
        console.error('Resetting due to incorrect Config: ' + config.toString(16));
        Reset();
    } 
}

var DumpRegisters = function () {
    console.log("Register dump:");
    for (var propertyName in Registers) {
        var val = Registers[propertyName];
        console.log(val + ' - ' + propertyName + ': ' + read(val).toString(16));
    }
}

var Reset = function () {

    console.log('RESET');

    // HARD RESET CHIP
    cs5490.DigitalPulse(OutputPins.reset, 0, 1, 100);

    sleep(500);

    DumpRegisters();

    cs5490.Instruction(0x01); // software Reset
    /*var s;
    do {
        if (!_DeviceOpen)
            return;

        s = read(Registers.Status0);
        console.log('status: ' + s.toString(16));

        if (!(s & 0x800000))
            sleep(500);
    } while (!(s & 0x800000));
*/
    write(Registers.Status0, 0xE5557D, "clear status");

    var config2 = read(Registers.Config2, 'read Config2 register');
    // A = 1010  => High-Pass filters enabled on both current and voltage channels
    write(Registers.Config2, config2 | 0xA)

    console.log('initialized');
}


var exports = {
    // returns true if able to communicate with hardware
    Initialize: function() {
        cs5490.Open("/dev/serial0", 600);   // raspberry pi
        var result = cs5490.ReadRegister(Registers.Config0[0], Registers.Config0[1]);
        return result & 0xFFFFFF;
    },
    // board should be 0-7
    // currentchannel should be 0-15
    // voltagechannel should be 0-3
    SetCircuit: function (board, currentChannel, voltageChannel) {
        if (board < 0 || board > 8) {
            console.log('Invalid board: ' + board);
            return;
        }

        if (currentChannel < 0 || currentChannel > 15) {
            console.log('Invalid current channel: ' + currentChannel);
            return;
        }

        if (voltageChannel < 0 || voltageChannel > 3) {
            console.log('Invalid voltage channel: ' + voltageChannel);
            return;
        }

        if (_DeviceOpen) {

            // disable
            cs5490.DigitalWrite(OutputPins.disable, 1);

            // set board
            cs5490.DigitalWrite(OutputPins.board0, (board & 0x1));
            cs5490.DigitalWrite(OutputPins.board1, (board & 0x2));
            cs5490.DigitalWrite(OutputPins.board2, (board & 0x4));

            // set current channel
            cs5490.DigitalWrite(OutputPins.channel0, (currentChannel & 0x1));
            cs5490.DigitalWrite(OutputPins.channel1, (currentChannel & 0x2));
            cs5490.DigitalWrite(OutputPins.channel2, (currentChannel & 0x4));
            cs5490.DigitalWrite(OutputPins.channel3, (currentChannel & 0x8));

            // set voltage channel
            cs5490.DigitalWrite(OutputPins.voltage0, (voltageChannel & 0x1));
            cs5490.DigitalWrite(OutputPins.voltage1, (voltageChannel & 0x2));

            // enable
            cs5490.DigitalWrite(OutputPins.disable, 0);
        }
    },
    ReadPower: function (iFactor, vFactor) {
    
        ResetIfNeeded();

        if (!_DeviceOpen)
            return;

        var result = {
            vInst: [],
            iInst: [],
            tsInst: [],
            ts: new Date(),
            tsZC: []
        };

        var lastV = 0, lastTsZC = 0, lastTs = 0, totalTime = 0, totalCount = 0;
        sampleBuffer.fill(0);

        // do measurement
        var instSamples;
        try {
            instSamples = cs5490.MeasureEnergy(sampleBuffer);
            if (instSamples <= 0) {
                console.log("MeasureEnergy returned: " + instSamples + ' samples');
                return null;
            }
        }
        catch (err) {
            //console.log("ReadCycleWithInterrupts failed: " + err);
            console.error("MeasureEnergy failed: " + err);
            return null;
        }

        // convert buffer values for instantaneous current and voltage
        // buffer is formatted as follows:  
        //      bytes 0-2: Instantaneous current
        //      bytes 3-5: Instantaneous voltage
        //      bytes 6-9: timestamp
        for (var s = 0; s < instSamples; s++) {
            var offset = s * bytesPerSample;

            var iInst = convert(sampleBuffer.slice(offset, offset + 3), 0, true) * iFactor;
            var vInst = convert(sampleBuffer.slice(offset + 3, offset + 6), 0, true) * vFactor;
            var tsInst = sampleBuffer.readInt32LE(offset + 6) / 1000000.0;

            result.iInst.push(Number(iInst));
            result.vInst.push(Number(vInst));
            result.tsInst.push(Number(tsInst));

            // frequency detect
            // look for zero crossing and ensure we didn't miss any samples 
            if ((lastV > 0 && vInst < 0) || (lastV < 0 && vInst > 0)) {

                var tsZCInterpolated = lastTs + lastV * (tsInst - lastTs) / (lastV - vInst)
                if (lastTsZC > 0 && (tsInst - lastTs) < 0.375) {
                    // Sample freq should be 4000Hz which is 0.25 ms per sample so use 0.375 for some margin
                    // if sample freq > 0.375 ms we'll assume a sample was missed and throw out the reading

                    // throw out any samples that are not between 40Hz and 70Hz
                    // ex: (1/40) / 2 = 12.5 ms
                    // ex: (1/70) / 2 = 7.1 ms
                    var sampleTime = tsZCInterpolated - lastTsZC;
                    if (sampleTime >= 7.1 && sampleTime <= 12.5) {
                        totalCount++;
                        totalTime += (tsZCInterpolated - lastTsZC);
                        result.tsZC.push(Number(tsZCInterpolated));
                    }
                }
                lastTsZC = tsZCInterpolated;
            }
            lastV = vInst;
            lastTs = tsInst;
        }

        if (totalCount > 0)
            result.CalculatedFrequency = 1000 / ((totalTime / totalCount) * 2);  //in Hz
        else
            result.CalculatedFrequency = 0;

        result.iRms = convertInt(read(Registers.RmsCurrent), -1, false) * iFactor;
        result.vRms = convertInt(read(Registers.RmsVoltage), -1, false) * vFactor;
        result.pAve = convertInt(read(Registers.ActivePower), 0, true) * vFactor * iFactor;
        result.qAve = convertInt(read(Registers.ReactivePower), 0, true) * vFactor * iFactor;  // average reactive power
        result.pf = convertInt(read(Registers.PowerFactor), 0, true);
        result.iPeak = convertInt(read(Registers.PeakCurrent), 0, true) * iFactor;
        result.vPeak = convertInt(read(Registers.PeakVoltge), 0, true) * vFactor;
        result.freq = convertInt(read(Registers.Epsilon), 0, true) * 4000.0;

        return result;
    },
    Frequency: function () {
        var epsilon = read(Registers.Epsilon);
        return 4000.0 * convertInt(epsilon, 0, true) + " Hz";
    },
    Close: function () {
        _DeviceOpen = false;
        if (cs5490 != null)
            cs5490.Close();
    },
    Open: function (data) {
        HardwareVersion = data.HardwareVersion;
        Mode = data.Mode;
        Config = data.Config;
        
        if (cs5490 != null) {
            cs5490.Open("/dev/serial0", 600);   // raspberry pi

            baud = 500000
            BR = Math.ceil(baud * 524288 / 4096000);
            write(Registers.SerialControl, (2 << 16) + BR); 
            cs5490.Open("/dev/serial0", baud)

            OutputPins = {
                channel0: 38,    
                channel1: 37,    
                channel2: 40,    
                channel3: 35,    
                board0: 22,      
                board1: 29,      
                board2: 33,      
                voltage0: 32,    
                voltage1: 31,    
                disable: 36,     
                reset: 15        
            }


            // enable output gpio pins
            for (var pin in OutputPins) {
                //console.log('pinmode(' + OutputPins[pin] + ') ' + pin);
                cs5490.PinMode(OutputPins[pin], 1);
            }

            _DeviceOpen = true;
            console.log("Device opened: Hardware version: " + HardwareVersion);

            Reset();
        }
    }
};

module.exports = exports;